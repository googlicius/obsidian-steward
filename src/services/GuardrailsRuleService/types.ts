export type GuardrailsAction =
  | 'read'
  | 'list'
  | 'create'
  | 'edit'
  | 'delete'
  | 'grep'
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
