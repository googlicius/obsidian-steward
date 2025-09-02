export type SearchPatternType = 'exact' | 'startsWith' | 'contains';

export interface ParsedRegexPattern {
  originalName: string;
  searchType: SearchPatternType;
}

// Interface for exact phrase match
export interface ExactPhraseMatch {
  originalPhrase: string;
  tokens: string[];
}
