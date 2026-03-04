import type StewardPlugin from 'src/main';
import { GuardrailsRuleService } from './GuardrailsRuleService';
import { ToolName } from 'src/solutions/commands/ToolRegistry';

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

  describe('validateRuleFrontmatter', () => {
    let validateRuleFrontmatter: GuardrailsRuleService['validateRuleFrontmatter'];

    beforeEach(() => {
      validateRuleFrontmatter = service['validateRuleFrontmatter'].bind(service);
    });

    it('returns valid for correct rule', () => {
      const result = validateRuleFrontmatter({
        name: 'No secrets',
        targets: ['Secrets/', '*.key'],
        actions: ['read', 'list', 'create'],
      });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.name).toBe('No secrets');
        expect(result.data.targets).toEqual(['Secrets/', '*.key']);
      }
    });

    it('returns invalid when name is missing', () => {
      const result = validateRuleFrontmatter({
        targets: ['folder/'],
        actions: ['read'],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some(e => e.includes('Rule name is required'))).toBe(true);
      }
    });

    it('returns invalid when targets is empty', () => {
      const result = validateRuleFrontmatter({
        name: 'Test',
        targets: [],
        actions: ['read'],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some(e => e.includes('At least one target'))).toBe(true);
      }
    });

    it('returns valid for rule with optional fields', () => {
      const result = validateRuleFrontmatter({
        name: 'Test rule',
        targets: ['folder/'],
        actions: ['read'],
        instruction: 'Never read from folder',
        enabled: true,
      });
      expect(result.valid).toBe(true);
    });

    it('returns invalid when name is empty', () => {
      const result = validateRuleFrontmatter({
        name: '',
        targets: ['folder/'],
        actions: ['read'],
      });
      expect(result.valid).toBe(false);
    });

    it('returns invalid when actions contains invalid value', () => {
      const result = validateRuleFrontmatter({
        name: 'Test',
        targets: ['folder/'],
        actions: ['invalid_action'],
      });
      expect(result.valid).toBe(false);
    });

    it('accepts enabled as string false', () => {
      const result = validateRuleFrontmatter({
        name: 'Disabled rule',
        targets: ['folder/'],
        actions: ['read'],
        enabled: 'false',
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('getRulesForTool', () => {
    it('applies list rules to search tool', () => {
      service['rules'] = [
        {
          name: 'No secret listing',
          path: 'Steward/Rules/no-secret-listing.md',
          targets: ['Secrets/'],
          actions: ['list'],
          enabled: true,
        },
      ];

      const rules = service.getRulesForTool(ToolName.SEARCH);

      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe('No secret listing');
    });
  });
});
