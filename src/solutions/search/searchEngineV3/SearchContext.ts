import { DocumentStore } from '../documentStore';
import { Tokenizer } from '../tokenizer';
import { Scoring } from '../scoring';

export interface SearchContext {
  documentStore: DocumentStore;
  nameTokenizer: Tokenizer;
  contentTokenizer: Tokenizer;
  scoring: Scoring;
}
