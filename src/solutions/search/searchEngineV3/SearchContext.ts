import { DocumentStore } from '../documentStore';
import { Tokenizer } from '../tokenizer';
import { Scoring } from '../scoring';

/**
 * Context object that provides shared dependencies to Condition classes.
 * This eliminates the need to pass individual dependencies to each condition.
 */
export interface SearchContext {
  documentStore: DocumentStore;
  nameTokenizer: Tokenizer;
  contentTokenizer: Tokenizer;
  scoring: Scoring;
}
