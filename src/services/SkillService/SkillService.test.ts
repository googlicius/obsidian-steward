import { TFile } from 'obsidian';
import i18next from 'src/i18n';
import type StewardPlugin from 'src/main';
import { getInstance } from 'src/utils/getInstance';
import { SkillService } from './SkillService';

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  return {
    app: {
      vault: {
        cachedRead: jest.fn(),
        on: jest.fn().mockReturnValue({ events: [] }),
      },
      fileManager: {
        processFrontMatter: jest.fn(),
      },
      workspace: {
        onLayoutReady: jest.fn().mockImplementation((callback: () => void) => {
          callback();
          return { events: [] };
        }),
      },
    },
    settings: {
      stewardFolder: 'Steward',
    },
    registerEvent: jest.fn(),
    noteContentService: {
      parseMarkdownFrontmatter: jest.fn(),
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('SkillService', () => {
  let skillService: SkillService;
  let mockPlugin: jest.Mocked<StewardPlugin>;

  beforeEach(() => {
    jest
      .spyOn(
        SkillService.prototype as unknown as { loadAllSkills: () => Promise<void> },
        'loadAllSkills'
      )
      .mockResolvedValue(undefined);

    mockPlugin = createMockPlugin();
    skillService = SkillService.getInstance(mockPlugin);
  });

  describe('needsFrontmatterScalar', () => {
    let needsFrontmatterScalar: (value: unknown) => boolean;

    beforeEach(() => {
      needsFrontmatterScalar = skillService['needsFrontmatterScalar'].bind(skillService);
    });

    it('returns true for undefined, null, or blank strings', () => {
      expect(needsFrontmatterScalar(undefined)).toBe(true);
      expect(needsFrontmatterScalar(null)).toBe(true);
      expect(needsFrontmatterScalar('')).toBe(true);
      expect(needsFrontmatterScalar('   ')).toBe(true);
    });

    it('returns false for non-empty strings and other defined values', () => {
      expect(needsFrontmatterScalar('name')).toBe(false);
      expect(needsFrontmatterScalar(0)).toBe(false);
      expect(needsFrontmatterScalar(false)).toBe(false);
    });
  });

  describe('defaultSkillNameFromPath', () => {
    let defaultSkillNameFromPath: (filePath: string) => string;

    beforeEach(() => {
      defaultSkillNameFromPath = skillService['defaultSkillNameFromPath'].bind(skillService);
    });

    it('uses the parent folder name for Steward/Skills/<folder>/SKILL.md', () => {
      expect(defaultSkillNameFromPath('Steward/Skills/my-tool/SKILL.md')).toBe('my-tool');
    });

    it('uses the i18n default when the skill sits directly under Skills', () => {
      expect(defaultSkillNameFromPath('Steward/Skills/SKILL.md')).toBe(
        i18next.t('skills.scaffoldDefaultName')
      );
    });

    it('uses the i18n default when the path has no directory segment', () => {
      expect(defaultSkillNameFromPath('SKILL.md')).toBe(i18next.t('skills.scaffoldDefaultName'));
    });
  });

  describe('ensureSkillNoteFrontmatter', () => {
    let ensureSkillNoteFrontmatter: (file: TFile) => Promise<void>;

    beforeEach(() => {
      ensureSkillNoteFrontmatter = skillService['ensureSkillNoteFrontmatter'].bind(skillService);
      jest
        .spyOn(
          skillService as unknown as {
            migrateLegacySkillDisabledFrontmatter: () => Promise<boolean>;
          },
          'migrateLegacySkillDisabledFrontmatter'
        )
        .mockResolvedValue(false);
    });

    it('fills missing name, description, and enabled via processFrontMatter', async () => {
      const file = getInstance(TFile, {
        path: 'Steward/Skills/sample-plugin/SKILL.md',
      });

      mockPlugin.app.vault.cachedRead = jest.fn().mockResolvedValue('---\n---\n');
      mockPlugin.noteContentService.parseMarkdownFrontmatter = jest
        .fn()
        .mockReturnValue({ frontmatter: {}, body: '' });

      let captured: Record<string, unknown> = {};
      mockPlugin.app.fileManager.processFrontMatter = jest
        .fn()
        .mockImplementation(async (_f: TFile, fn: (fm: Record<string, unknown>) => void) => {
          captured = {};
          fn(captured);
        });

      await ensureSkillNoteFrontmatter(file);

      expect(captured.name).toBe('sample-plugin');
      expect(captured.description).toBe(i18next.t('skills.scaffoldDefaultDescription'));
      expect(captured.enabled).toBe(true);
    });

    it('does not replace non-empty name and description', async () => {
      const file = getInstance(TFile, {
        path: 'Steward/Skills/sample-plugin/SKILL.md',
      });

      mockPlugin.app.vault.cachedRead = jest.fn().mockResolvedValue('body');
      mockPlugin.noteContentService.parseMarkdownFrontmatter = jest.fn().mockReturnValue({
        frontmatter: {},
        body: '',
      });

      let captured: Record<string, unknown> = {};
      mockPlugin.app.fileManager.processFrontMatter = jest
        .fn()
        .mockImplementation(async (_f: TFile, fn: (fm: Record<string, unknown>) => void) => {
          captured = { name: 'Keep Me', description: 'Already set' };
          fn(captured);
        });

      await ensureSkillNoteFrontmatter(file);

      expect(captured.name).toBe('Keep Me');
      expect(captured.description).toBe('Already set');
      expect(captured.enabled).toBe(true);
    });

    it('sets enabled to true only when the key is missing', async () => {
      const file = getInstance(TFile, {
        path: 'Steward/Skills/x/SKILL.md',
      });

      mockPlugin.app.vault.cachedRead = jest.fn().mockResolvedValue('');
      mockPlugin.noteContentService.parseMarkdownFrontmatter = jest.fn().mockReturnValue({
        frontmatter: {},
        body: '',
      });

      let captured: Record<string, unknown> = {};
      mockPlugin.app.fileManager.processFrontMatter = jest
        .fn()
        .mockImplementation(async (_f: TFile, fn: (fm: Record<string, unknown>) => void) => {
          captured = { name: 'n', description: 'd', enabled: false };
          fn(captured);
        });

      await ensureSkillNoteFrontmatter(file);

      expect(captured.enabled).toBe(false);
    });
  });

  describe('getSkillCatalog', () => {
    it('returns only enabled skills with name, description, and path', () => {
      skillService.skills = new Map([
        [
          'alpha',
          {
            name: 'alpha',
            description: 'desc-a',
            content: 'body-a',
            filePath: 'Steward/Skills/alpha/SKILL.md',
            enabled: true,
          },
        ],
        [
          'beta',
          {
            name: 'beta',
            description: 'desc-b',
            content: 'body-b',
            filePath: 'Steward/Skills/beta/SKILL.md',
            enabled: false,
          },
        ],
      ]);

      expect(skillService.getSkillCatalog()).toEqual([
        {
          name: 'alpha',
          description: 'desc-a',
          path: 'Steward/Skills/alpha/SKILL.md',
        },
      ]);
    });

    it('returns an empty array when no enabled skills exist', () => {
      skillService.skills = new Map([
        [
          'off',
          {
            name: 'off',
            description: 'd',
            content: '',
            filePath: 'p.md',
            enabled: false,
          },
        ],
      ]);

      expect(skillService.getSkillCatalog()).toEqual([]);
    });
  });

  describe('getSkillContents', () => {
    beforeEach(() => {
      skillService.skills = new Map([
        [
          'on',
          {
            name: 'on',
            description: 'd',
            content: 'skill body',
            filePath: 'Steward/Skills/on/SKILL.md',
            enabled: true,
          },
        ],
        [
          'off',
          {
            name: 'off',
            description: 'd',
            content: 'hidden',
            filePath: 'Steward/Skills/off/SKILL.md',
            enabled: false,
          },
        ],
      ]);
    });

    it('returns content for enabled skills and lists disabled or unknown as invalid', () => {
      const result = skillService.getSkillContents(['on', 'off', 'missing']);

      expect(result.activatedSkills).toEqual(['on']);
      expect(result.invalidSkills).toEqual(['off', 'missing']);
      expect(result.contents).toEqual({ on: 'skill body' });
    });

    it('preserves request order in activatedSkills', () => {
      skillService.skills.set('second', {
        name: 'second',
        description: '',
        content: '2',
        filePath: 'b.md',
        enabled: true,
      });
      skillService.skills.set('first', {
        name: 'first',
        description: '',
        content: '1',
        filePath: 'a.md',
        enabled: true,
      });

      const result = skillService.getSkillContents(['first', 'second']);

      expect(result.activatedSkills).toEqual(['first', 'second']);
      expect(result.contents.first).toBe('1');
      expect(result.contents.second).toBe('2');
    });
  });
});
