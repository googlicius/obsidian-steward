import { STW_SELECTED_PATTERN, STW_SQUEEZED_PATTERN } from '../../../constants';

/**
 * Interface for text normalizers that transform content before tokenization.
 * Normalizers handle tasks like case folding, accent removal, or special character handling
 * to standardize text for more effective search and analysis.
 */
export interface Normalizer {
  name: string;
  apply: (content: string) => string;
}

/**
 * Splits camelCase and PascalCase words by inserting spaces at case boundaries.
 * Uses Unicode-aware character classes to handle accented characters (e.g., CaféMenu → Café Menu).
 * Examples:
 *   - MeetingNotes → Meeting Notes
 *   - meetingNotes → meeting Notes
 *   - XMLParser → XML Parser
 *   - getHTTPResponse → get HTTP Response
 *   - CaféMenu → Café Menu
 */
export function splitCamelCase(text: string): string {
  return text
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2') // camelCase → camel Case (Unicode lowercase followed by uppercase)
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2'); // XMLParser → XML Parser
}

/**
 * Removes diacritical marks from text for normalized matching.
 * Example: "Café" → "Cafe"
 */
export function removeDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC');
}

export const ALL_NORMALIZERS: Record<string, Normalizer['apply']> = {
  removeHtmlComments: (content: string) => content.replace(/<!--[\s\S]*?-->/g, ' '),
  /**
   * Splits camelCase and PascalCase words by inserting spaces at case boundaries.
   * Must run BEFORE lowercase normalizer to preserve case information.
   */
  splitCamelCase,
  lowercase: (content: string) => content.toLowerCase(),
  removeSpecialChars: (content: string) =>
    content
      .replace(/[^\p{L}\p{N}'\u2019\s#_-]/gu, ' ') // Keep letters, numbers, apostrophes, hashtags, underscores, hyphens
      .replace(/[#_-]{2,}/g, ' '), // Filter out 2+ consecutive special characters
  removeDiacritics,
  removeStwSelectedPatterns: (content: string) =>
    content.replace(new RegExp(STW_SELECTED_PATTERN, 'g'), ' '),
  removeStwSqueezedPatterns: (content: string) =>
    content.replace(new RegExp(STW_SQUEEZED_PATTERN, 'g'), ' '),
  removeTagPrefix: (content: string) => content.replace(/#([^#\s]+)/g, '$1'),
};
