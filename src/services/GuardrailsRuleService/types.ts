export type GuardrailsAction =
  | 'read'
  | 'list'
  | 'create'
  | 'edit'
  | 'delete'
  | 'move'
  | 'rename'
  | 'copy';

export interface GuardrailsRule {
  name: string;
  path: string;
  targets: string[];
  actions: GuardrailsAction[];
  instruction?: string;
  enabled?: boolean;
}
