import { App, TFile } from 'obsidian';
import type * as PDFJSLib from 'pdfjs-dist';
import { logger } from '../../../utils/logger';
import { PDFExtractionResult, PDFPageContent, PDFTextItem, PDFTextPosition } from './types';

/**
 * CDN URLs for PDF.js library
 * Using pinned version for stability (must match pdfjs-dist devDependency for types)
 */
const PDFJS_CDN = {
  lib: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs',
  worker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs',
};

/**
 * Service for extracting text content from PDF files using PDF.js loaded from CDN
 */
type PDFJSLibType = typeof PDFJSLib;

export class PDFExtractor {
  private pdfjsLib: PDFJSLibType | null = null;
  private loadingPromise: Promise<PDFJSLibType> | null = null;

  constructor(private app: App) {}

  /**
   * Load PDF.js library from CDN
   * Caches the library after first load
   */
  private async loadPDFJS(): Promise<PDFJSLibType> {
    if (this.pdfjsLib) {
      return this.pdfjsLib;
    }

    // Prevent multiple concurrent loads
    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = this.doLoadPDFJS();
    try {
      this.pdfjsLib = await this.loadingPromise;
      return this.pdfjsLib;
    } finally {
      this.loadingPromise = null;
    }
  }

  /**
   * Actually load the PDF.js library from CDN
   */
  private async doLoadPDFJS(): Promise<PDFJSLibType> {
    try {
      logger.log('Loading PDF.js from CDN...');

      // Dynamic import from CDN using webpackIgnore to prevent bundling
      const pdfjs = (await import(/* webpackIgnore: true */ PDFJS_CDN.lib)) as PDFJSLibType;

      // Configure worker
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_CDN.worker;

      logger.log('PDF.js loaded successfully');
      return pdfjs;
    } catch (error) {
      logger.error('Failed to load PDF.js from CDN:', error);
      throw new Error('Failed to load PDF library. Please check your internet connection.');
    }
  }

  /**
   * Check if PDF.js is loaded
   */
  public isLoaded(): boolean {
    return this.pdfjsLib !== null;
  }

  /**
   * Extract text content from a PDF file
   * @param file The PDF file to extract text from
   * @returns Extraction result with full text and per-page position data
   */
  public async extractText(file: TFile): Promise<PDFExtractionResult | null> {
    if (file.extension !== 'pdf') {
      logger.error('File is not a PDF:', file.path);
      return null;
    }

    try {
      const pdfjs = await this.loadPDFJS();

      // Read the PDF file as ArrayBuffer
      const arrayBuffer = await this.app.vault.readBinary(file);

      // Load the PDF document
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;

      const pages: PDFPageContent[] = [];
      const allText: string[] = [];

      // Extract text from each page
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();

        const textItems: PDFTextItem[] = [];
        const pageText: string[] = [];
        let charIndex = 0;

        for (let itemIndex = 0; itemIndex < textContent.items.length; itemIndex++) {
          const item = textContent.items[itemIndex];
          if ('str' in item && item.str) {
            textItems.push({
              str: item.str,
              itemIndex,
              charIndex,
            });
            pageText.push(item.str);
            charIndex += item.str.length;
          }
        }

        const fullText = pageText.join(' ');
        pages.push({
          pageNumber: pageNum,
          textItems,
          fullText,
        });
        allText.push(fullText);
      }

      return {
        fullText: allText.join('\n'),
        pages,
      };
    } catch (error) {
      logger.error('Failed to extract text from PDF:', file.path, error);
      return null;
    }
  }

  /**
   * Generate an Obsidian PDF deep link
   * @param filePath Path to the PDF file
   * @param position Position data from findTextPosition
   * @param displayText Optional display text for the link
   * @returns Obsidian wikilink string
   */
  public generateDeepLink(
    filePath: string,
    position: PDFTextPosition,
    displayText?: string
  ): string {
    const { pageNumber, beginIndex, beginOffset, endIndex, endOffset } = position;
    const selection = `${beginIndex},${beginOffset},${endIndex},${endOffset}`;
    const fragment = `page=${pageNumber}&selection=${selection}`;

    if (displayText) {
      return `[[${filePath}#${fragment}|${displayText}]]`;
    }
    return `[[${filePath}#${fragment}]]`;
  }

  /**
   * Generate a simple page link (without selection)
   * @param filePath Path to the PDF file
   * @param pageNumber 1-based page number
   * @param displayText Optional display text for the link
   * @returns Obsidian wikilink string
   */
  public generatePageLink(filePath: string, pageNumber: number, displayText?: string): string {
    if (displayText) {
      return `[[${filePath}#page=${pageNumber}|${displayText}]]`;
    }
    return `[[${filePath}#page=${pageNumber}]]`;
  }
}
