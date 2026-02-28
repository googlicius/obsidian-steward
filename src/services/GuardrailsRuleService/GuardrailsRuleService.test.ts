import type StewardPlugin from 'src/main';
import { GuardrailsRuleService } from './GuardrailsRuleService';

function createMockPlugin(): StewardPlugin {
  return {
    settings: { stewardFolder: 'Steward' },
    app: {
      workspace: {
        onLayoutReady: jest.fn(),
      },
      registerEvent: jest.fn(),
      vault: {
        on: jest.fn().mockReturnValue({}),
      },
      metadataCache: {},
      fileManager: {},
    },
  } as unknown as StewardPlugin;
}

describe('GuardrailsRuleService', () => {
  let service: GuardrailsRuleService;

  beforeEach(() => {
    GuardrailsRuleService.getInstance(createMockPlugin());
    service = GuardrailsRuleService.getInstance();
  });

  describe('validateRule', () => {
    it('returns valid for correct rule', () => {
      const result = service.validateRule({
        name: 'No secrets',
        targets: ['Secrets/', '*.key'],
        actions: ['read', 'list', 'create'],
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('returns valid for rule with optional fields', () => {
      const result = service.validateRule({
        name: 'Test rule',
        targets: ['folder/'],
        actions: ['read'],
        instruction: 'Never read from folder',
        enabled: true,
      });
      expect(result.valid).toBe(true);
    });

    it('returns invalid when name is missing', () => {
      const result = service.validateRule({
        targets: ['folder/'],
        actions: ['read'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Rule name is required'))).toBe(true);
    });

    it('returns invalid when name is empty', () => {
      const result = service.validateRule({
        name: '',
        targets: ['folder/'],
        actions: ['read'],
      });
      expect(result.valid).toBe(false);
    });

    it('returns invalid when targets is empty', () => {
      const result = service.validateRule({
        name: 'Test',
        targets: [],
        actions: ['read'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('At least one target'))).toBe(true);
    });

    it('returns invalid when actions contains invalid value', () => {
      const result = service.validateRule({
        name: 'Test',
        targets: ['folder/'],
        actions: ['invalid_action'],
      });
      expect(result.valid).toBe(false);
    });

    it('accepts enabled as string false', () => {
      const result = service.validateRule({
        name: 'Disabled rule',
        targets: ['folder/'],
        actions: ['read'],
        enabled: 'false',
      });
      expect(result.valid).toBe(true);
    });
  });
});
