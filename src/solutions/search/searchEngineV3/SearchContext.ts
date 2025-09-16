import { type DocumentStore } from '../documentStore';
import { type Tokenizer } from '../tokenizer/tokenizer';
import { type Scoring } from '../scoring';

export interface SearchContext {
  documentStore: DocumentStore;
  nameTokenizer: Tokenizer;
  contentTokenizer: Tokenizer;
  scoring: Scoring;
}
