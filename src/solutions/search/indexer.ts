import { App, TFile, EventRef, MarkdownView } from 'obsidian';
import { DocumentStore } from './documentStore';
import { Tokenizer } from './tokenizer';
import { TermSource } from '../../database/SearchDatabase';
import { logger } from '../../utils/logger';
import { COMMAND_PREFIXES } from '../../constants';

export interface IndexerConfig {
  app: App;
  documentStore: DocumentStore;
  contentTokenizer: Tokenizer;
  nameTokenizer: Tokenizer;
}

export class Indexer {
  private app: App;
  private documentStore: DocumentStore;
  private contentTokenizer: Tokenizer;
  private nameTokenizer: Tokenizer;
  private indexingQueue: string[] = [];
  private isIndexing = false;
  private isIndexBuilt = false;
  // Simple cache for current note
  private cachedNotePath: string | null = null;
  private cachedNoteTermsCount = 0;

  constructor({ app, documentStore, contentTokenizer, nameTokenizer }: IndexerConfig) {
    this.app = app;
    this.documentStore = documentStore;
    this.contentTokenizer = contentTokenizer;
    this.nameTokenizer = nameTokenizer;
  }

  /**
   * Set up event listeners for file changes
   */
  public setupEventListeners(): EventRef[] {
    const eventRefs: EventRef[] = [];

    // Listen for active leaf changes to update the cache
    eventRefs.push(
      this.app.workspace.on('active-leaf-change', async leaf => {
        // Skip if index is not built
        if (!this.isIndexBuilt) return;

        const view = leaf?.view;
        if (view instanceof MarkdownView && view.file) {
          const file = view.file;
          // Skip files in excluded folders
          if (!this.documentStore.isExcluded(file.path)) {
            await this.updateCachedNote(file);
          } else {
            // Clear cache if in excluded folder
            this.clearCachedNote();
          }
        }
      })
    );
    eventRefs.push(
      // Listen for file creations
      this.app.vault.on('create', async file => {
        // Skip if index is not built
        if (!this.isIndexBuilt) return;

        if (file instanceof TFile) {
          this.queueFileForIndexing(file.path);
        }
      }),
      // Listen for file modifications
      this.app.vault.on('modify', async file => {
        // Skip if index is not built
        if (!this.isIndexBuilt) return;

        if (file instanceof TFile) {
          // Skip files in excluded folders
          if (this.documentStore.isExcluded(file.path)) {
            return;
          }

          // For markdown files, do special handling with command prefixes and caching
          if (file.extension === 'md') {
            // Check if file content contains command prefixes before indexing
            const content = await this.app.vault.cachedRead(file);

            // Check if this is the cached note
            if (this.cachedNotePath === file.path) {
              // Get new terms count
              const newTerms = this.contentTokenizer.tokenize(content);
              const newTermsCount = newTerms.length;

              // If terms count differs, reindex
              if (this.cachedNoteTermsCount !== newTermsCount) {
                logger.log(
                  `Terms count changed for ${file.path}: ${this.cachedNoteTermsCount} -> ${newTermsCount}`
                );
                this.queueFileForIndexing(file.path);

                // Update cache with new terms count
                this.cachedNoteTermsCount = newTermsCount;
              } else {
                logger.log(`Terms count unchanged for ${file.path}, skipping indexing`);
              }
            } else {
              // Not the cached note, proceed with normal indexing
              this.queueFileForIndexing(file.path);
            }
          } else {
            // For non-markdown files, just queue for indexing
            this.queueFileForIndexing(file.path);
          }
        }
      }),
      // Listen for file deletions
      this.app.vault.on('delete', file => {
        // Skip if index is not built
        if (!this.isIndexBuilt) return;

        if (file instanceof TFile) {
          this.removeFromIndex(file.path);

          // Clear cache if this was the cached note (for markdown files)
          if (file.extension === 'md' && this.cachedNotePath === file.path) {
            this.clearCachedNote();
          }
        }
      }),
      // Listen for file renames
      this.app.vault.on('rename', async (file, oldPath: string) => {
        // Skip if index is not built
        if (!this.isIndexBuilt) return;

        if (file instanceof TFile) {
          this.removeFromIndex(oldPath);

          // Update cache if this was the cached note (for markdown files)
          if (file.extension === 'md' && this.cachedNotePath === oldPath) {
            this.cachedNotePath = file.path;
          }

          // Skip files in excluded folders
          if (this.documentStore.isExcluded(file.path)) {
            return;
          }

          this.queueFileForIndexing(file.path);
        }
      })
    );

    return eventRefs;
  }

  /**
   * Check if content contains command prefixes
   */
  private containsCommandPrefix(content: string): boolean {
    const commandPrefixPattern = new RegExp(
      `^\\s*(${COMMAND_PREFIXES.join('|').replace(/\//g, '\\/')})\\b`,
      'm'
    );
    return commandPrefixPattern.test(content);
  }

  /**
   * Queue a file for indexing
   */
  public queueFileForIndexing(filePath: string) {
    if (!this.indexingQueue.includes(filePath)) {
      this.indexingQueue.push(filePath);
      this.processQueue();
    }
  }

  /**
   * Process the indexing queue
   */
  private async processQueue() {
    if (this.isIndexing || this.indexingQueue.length === 0) return;

    this.isIndexing = true;

    try {
      const filePath = this.indexingQueue.shift();
      if (!filePath) return;
      const file = this.app.vault.getFileByPath(filePath);

      if (file) {
        await this.indexFile(file);
      }
    } catch (error) {
      logger.error('Error processing indexing queue:', error);
    } finally {
      this.isIndexing = false;
      // Continue processing if there are more files
      if (this.indexingQueue.length > 0) {
        this.processQueue();
      }
    }
  }

  /**
   * Index a single file
   */
  public async indexFile(file: TFile) {
    try {
      // Skip files in excluded folders
      if (this.documentStore.isExcluded(file.path)) {
        return;
      }

      let content = '';
      const tags: string[] = [];

      // Process file based on its type
      if (file.extension === 'md') {
        content = await this.documentStore.readFile(file);

        // Skip markdown files with command prefixes
        if (this.containsCommandPrefix(content)) {
          return;
        }

        const cache = this.documentStore.getFileCache(file);

        // Extract tags from content and frontmatter for markdown files
        if (cache?.tags) {
          tags.push(...cache.tags.map(t => t.tag));
        }

        if (cache?.frontmatter?.tags) {
          if (Array.isArray(cache.frontmatter.tags)) {
            tags.push(...cache.frontmatter.tags.map((t: string) => `#${t}`));
          } else if (typeof cache.frontmatter.tags === 'string') {
            tags.push(`#${cache.frontmatter.tags}`);
          }
        }
      } else {
        // For non-markdown files, use the filename as content
        content = file.basename;
      }

      // Extract the folder path from the file path
      const folderPath = file.path.substring(0, file.path.lastIndexOf('/'));
      const folderName = folderPath.split('/').pop() || '';

      // Create or update document in the index
      const folderId = await this.indexFolder(folderPath, folderName);
      const documentId = await this.indexDocument(file, content, tags);
      await this.indexTerms(content, documentId, folderId, file.basename);
    } catch (error) {
      logger.error(`Error indexing file ${file.path}:`, error);
    }
  }

  /**
   * Index a folder and return its ID
   */
  private async indexFolder(folderPath: string, folderName: string): Promise<number> {
    // Default to 0 if no folder path exists
    if (!folderPath) {
      return 0;
    }

    // Check if folder exists already
    const folder = await this.documentStore.getFolderByPath(folderPath);

    if (!folder) {
      // Add new folder
      return this.documentStore.storeFolder({
        path: folderPath,
        name: folderName,
      });
    } else {
      return folder.id as number;
    }
  }

  /**
   * Index a document and return its ID
   */
  private async indexDocument(file: TFile, content: string, tags: string[]): Promise<number> {
    // Find existing document by path
    const existingDoc = await this.documentStore.getDocumentByPath(file.path);

    const fileName = file.basename;

    // Calculate token count
    const tokenCount = content.split(/\s+/).length;

    const documentData = {
      path: file.path,
      fileName,
      lastModified: file.stat.mtime,
      tags: [...new Set(tags)],
      tokenCount,
    };

    if (existingDoc) {
      // Update existing document
      const documentId = existingDoc.id as number;
      await this.documentStore.updateDocument(documentId, documentData);

      // Remove existing terms for this document
      await this.documentStore.deleteTerms(documentId);

      return documentId;
    } else {
      // Create new document
      return this.documentStore.storeDocument(documentData);
    }
  }

  /**
   * Index terms for a document
   */
  private async indexTerms(
    content: string,
    documentId: number,
    folderId: number,
    fileName: string
  ): Promise<void> {
    // Tokenize content
    const contentTerms = this.contentTokenizer.tokenize(content);

    // Tokenize filename
    const filenameTerms = this.nameTokenizer.tokenize(fileName);

    // Batch add content terms
    const contentTermBatch = contentTerms.map(term => ({
      term: term.term,
      documentId: documentId,
      folderId: folderId || 0, // Use 0 as fallback if no folder ID
      source: TermSource.Content,
      frequency: term.count,
      positions: term.positions,
    }));

    // Batch add filename terms
    const filenameTermBatch = filenameTerms.map(term => ({
      term: term.term,
      documentId: documentId,
      folderId: folderId || 0, // Use 0 as fallback if no folder ID
      source: TermSource.Filename,
      frequency: term.count,
      positions: term.positions,
    }));

    // Combine both batches and add to database
    const allTerms = [...contentTermBatch, ...filenameTermBatch];
    await this.documentStore.storeTerms(allTerms);
  }

  /**
   * Remove a file from the index
   */
  public async removeFromIndex(filePath: string) {
    const document = await this.documentStore.getDocumentByPath(filePath);

    if (document) {
      // Delete all terms associated with the document
      await this.documentStore.deleteTerms(document.id as number);

      // Delete the document
      await this.documentStore.deleteDocument(document.id as number);
    }

    // Get folder ID for this path
    const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
    const folder = await this.documentStore.getFolderByPath(folderPath);

    // If we found a folder, check if it should be removed
    if (folder && folder.id !== undefined) {
      // Check if this was the last file in this folder by counting documents with paths starting with folderPath
      const hasDocumentsInFolder = await this.documentStore.getDocumentCountInFolder(folderPath);

      // If no more files in this folder, remove the folder from the folders table
      if (hasDocumentsInFolder === 0) {
        await this.documentStore.deleteDocument(folder.id);
      }
    }
  }

  /**
   * Update the cached note terms count
   */
  private async updateCachedNote(file: TFile): Promise<void> {
    try {
      const content = await this.app.vault.cachedRead(file);

      // Update cache
      this.cachedNotePath = file.path;
      this.cachedNoteTermsCount = this.contentTokenizer.tokenize(content).length;

      logger.log(`Updated cached note: ${file.path} with ${this.cachedNoteTermsCount} terms`);
    } catch (error) {
      logger.error(`Error updating cached note ${file.path}:`, error);
      this.clearCachedNote();
    }
  }

  /**
   * Clear the cached note data
   */
  private clearCachedNote(): void {
    this.cachedNotePath = null;
    this.cachedNoteTermsCount = 0;
  }

  /**
   * Set the index built status
   */
  public setIndexBuilt(status: boolean): void {
    this.isIndexBuilt = status;
    logger.log(`Search index built status set to: ${status}`);
  }
}
