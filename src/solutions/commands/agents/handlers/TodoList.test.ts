import { expectZodIssuesContaining } from './testUtils';
import { googleTodoWriteSchema, type TodoWriteArgs } from './TodoList';

describe('TodoList', () => {
  describe('googleTodoWriteSchema', () => {
    describe('superRefine validation errors', () => {
      it('rejects create without steps', () => {
        expectZodIssuesContaining({
          fn: () =>
            googleTodoWriteSchema.parse({
              operations: [{ operation: 'create' }],
            }),
          path: ['operations', 0, 'steps'],
          messageSubstring: 'steps is required when operation is create',
        });
      });

      it('rejects create with empty steps array', () => {
        expectZodIssuesContaining({
          fn: () =>
            googleTodoWriteSchema.parse({
              operations: [{ operation: 'create', steps: [] }],
            }),
          path: ['operations', 0, 'steps'],
          messageSubstring: 'steps is required when operation is create',
        });
      });

      it('rejects create when status is present', () => {
        expectZodIssuesContaining({
          fn: () =>
            googleTodoWriteSchema.parse({
              operations: [
                {
                  operation: 'create',
                  steps: [{ task: 'a' }],
                  currentStepStatus: 'in_progress',
                },
              ],
            }),
          path: ['operations', 0, 'currentStepStatus'],
          messageSubstring: 'currentStepStatus must be omitted when operation is create',
        });
      });

      it('rejects create when nextStep is present', () => {
        expectZodIssuesContaining({
          fn: () =>
            googleTodoWriteSchema.parse({
              operations: [
                {
                  operation: 'create',
                  steps: [{ task: 'a' }],
                  nextStep: 2,
                },
              ],
            }),
          path: ['operations', 0, 'nextStep'],
          messageSubstring: 'nextStep must be omitted when operation is create',
        });
      });

      it('rejects update without status', () => {
        expectZodIssuesContaining({
          fn: () =>
            googleTodoWriteSchema.parse({
              operations: [{ operation: 'update' }],
            }),
          path: ['operations', 0, 'currentStepStatus'],
          messageSubstring: 'currentStepStatus is required when operation is update',
        });
      });

      it('rejects update when steps is present', () => {
        expectZodIssuesContaining({
          fn: () =>
            googleTodoWriteSchema.parse({
              operations: [
                {
                  operation: 'update',
                  currentStepStatus: 'completed',
                  steps: [{ task: 'x' }],
                },
              ],
            }),
          path: ['operations', 0, 'steps'],
          messageSubstring: 'steps must be omitted when operation is update',
        });
      });
    });

    describe('transform to primary TodoWriteArgs shape', () => {
      it('maps create with steps to operations array', () => {
        const input = {
          operations: [
            {
              operation: 'create' as const,
              steps: [{ task: 'First' }, { task: 'Second' }],
            },
          ],
        };

        const result = googleTodoWriteSchema.parse(input) as TodoWriteArgs;

        expect(result).toEqual({
          operations: [
            {
              operation: 'create',
              steps: [{ task: 'First' }, { task: 'Second' }],
            },
          ],
        });
      });

      it('maps update with status only', () => {
        const input = {
          operations: [
            {
              operation: 'update' as const,
              currentStepStatus: 'skipped' as const,
            },
          ],
        };

        const result = googleTodoWriteSchema.parse(input) as TodoWriteArgs;

        expect(result).toEqual({
          operations: [{ operation: 'update', currentStepStatus: 'skipped' }],
        });
      });

      it('maps update with status and nextStep', () => {
        const input = {
          operations: [
            {
              operation: 'update' as const,
              currentStepStatus: 'in_progress' as const,
              nextStep: 3,
            },
          ],
        };

        const result = googleTodoWriteSchema.parse(input) as TodoWriteArgs;

        expect(result).toEqual({
          operations: [{ operation: 'update', currentStepStatus: 'in_progress', nextStep: 3 }],
        });
      });
    });
  });
});
