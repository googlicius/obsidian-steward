/**
 * Represents a text item extracted from a PDF page with position data
 * for generating Obsidian deep links
 */
export interface PDFTextItem {
  /** The text content */
  str: string;
  /** Index in page's textContent.items array (used for selection parameter) */
  itemIndex: number;
  /** Character offset within the text item */
  charIndex: number;
}

/**
 * Represents extracted content from a single PDF page
 */
export interface PDFPageContent {
  /** 1-based page number */
  pageNumber: number;
  /** All text items on this page with position data */
  textItems: PDFTextItem[];
  /** Full concatenated text for this page */
  fullText: string;
}

/**
 * Result of PDF text extraction
 */
export interface PDFExtractionResult {
  /** Full text content from all pages (for indexing) */
  fullText: string;
  /** Per-page content with position data (for deep linking) */
  pages: PDFPageContent[];
}

/**
 * Result of finding text position in a PDF
 */
export interface PDFTextPosition {
  /** 1-based page number */
  pageNumber: number;
  /** Begin index for selection parameter */
  beginIndex: number;
  /** Begin offset for selection parameter */
  beginOffset: number;
  /** End index for selection parameter */
  endIndex: number;
  /** End offset for selection parameter */
  endOffset: number;
}

// ============================================================================
// Position Encoding for PDF Indexing
// ============================================================================

/**
 * Multiplier for encoding itemIndex and charOffset into a single position value.
 * Assumes charOffset < 10000 (text items rarely exceed 10000 characters)
 */
export const PDF_POSITION_MULTIPLIER = 10000;

/**
 * Encode itemIndex and charOffset into a single position value for storage in the terms table.
 * @param itemIndex - Index of the text item in the PDF page
 * @param charOffset - Character offset within the text item
 * @returns Encoded position value
 */
export function encodePDFPosition(itemIndex: number, charOffset: number): number {
  return itemIndex * PDF_POSITION_MULTIPLIER + charOffset;
}

/**
 * Decode a position value into itemIndex and charOffset.
 * @param position - Encoded position value from the terms table
 * @returns Object with itemIndex and charOffset
 */
export function decodePDFPosition(position: number): { itemIndex: number; charOffset: number } {
  return {
    itemIndex: Math.floor(position / PDF_POSITION_MULTIPLIER),
    charOffset: position % PDF_POSITION_MULTIPLIER,
  };
}

/**
 * Parse a PDF page document path to extract the PDF path, page number, and optional selection.
 * @param path - Document path in format "file.pdf#page=N[&selection=A,B,C,D]"
 * @returns Object with pdfPath, pageNumber, and selection, or null if not a valid page path
 */
export function parsePDFPagePath(
  path: string
): { pdfPath: string; pageNumber: number; selection?: string } | null {
  const match = path.match(/^(.+\.pdf)#page=(\d+)(?:&selection=([^&]+))?$/i);
  if (!match) return null;
  return {
    pdfPath: match[1],
    pageNumber: parseInt(match[2], 10),
    selection: match[3],
  };
}
