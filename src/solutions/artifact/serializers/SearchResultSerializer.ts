import { ArtifactSerializer, ArtifactType, SearchResultsArtifact } from '../types';
import { DocumentStore } from 'src/solutions/search/documentStore';
import { ConditionResult } from 'src/solutions/search/searchEngineV3';
import { IndexedDocument } from 'src/database/SearchDatabase';

/**
 * Serializer for search results that only stores document IDs
 * instead of full document objects to save space
 */
export class SearchResultSerializer extends ArtifactSerializer {
  constructor(private documentStore: DocumentStore) {
    super();
  }

  /**
   * Serialize a search result artifact to a string
   * Extracts only the document IDs, scores, and keywords matched
   */
  serialize(artifact: SearchResultsArtifact) {
    if (artifact.artifactType !== ArtifactType.SEARCH_RESULTS) {
      throw new Error(
        `Type mismatch: expected ${ArtifactType.SEARCH_RESULTS}, got ${artifact.artifactType}`
      );
    }

    // Extract only the necessary information from each result
    // Using shortened field names to reduce serialized size
    const simplifiedResults = artifact.originalResults.map(result => ({
      i: result.document.id,
      s: result.score,
      k: result.keywordsMatched,
    }));

    return simplifiedResults;
  }

  /**
   * Deserialize a string to a search result artifact
   * Retrieves full document objects from the document store
   */
  async deserialize(data: string): Promise<SearchResultsArtifact> {
    try {
      // Parse the simplified results
      const simplifiedResults = JSON.parse(data);

      if (!Array.isArray(simplifiedResults)) {
        throw new Error('Invalid search results data: not an array');
      }

      // Get all document IDs
      const documentIds = simplifiedResults.map(result => result.i);

      // Get the full documents from the document store
      const documents = await this.documentStore.getDocumentsByIds(documentIds);

      // Create a map of document ID to document for quick lookup
      const documentMap = new Map<number, IndexedDocument>();
      documents.forEach(doc => documentMap.set(doc.id as number, doc));

      // Reconstruct the full results
      const originalResults: ConditionResult<IndexedDocument>[] = simplifiedResults.map(result => ({
        document: documentMap.get(result.i) as IndexedDocument,
        score: result.s,
        keywordsMatched: result.k,
      }));

      // Create and return the search results artifact
      return {
        artifactType: ArtifactType.SEARCH_RESULTS,
        originalResults,
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in search results data: ${error.message}`);
      }
      throw error;
    }
  }
}
