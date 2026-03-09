export type GuardrailsAction =
  | 'read'
  | 'list'
  | 'create'
  | 'edit'
  | 'delete'
  | 'exists'
  | 'move'
  | 'rename'
  | 'copy'
  | 'update_frontmatter';

export interface GuardrailsRule {
  name: string;
  path: string;
  targets: string[];
  actions: GuardrailsAction[];
  instruction?: string;
  enabled?: boolean;
}
