import { TFile, TFolder } from 'obsidian';
import { getInstance } from 'src/utils/getInstance';
import type StewardPlugin from 'src/main';
import { WidgetService } from './WidgetService';

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  const indexFile = getInstance(TFile, {
    path: 'Steward/Widgets/chat-1/abc12/index.html',
    name: 'index.html',
  });
  const manifestFile = getInstance(TFile, {
    path: 'Steward/Widgets/chat-1/abc12/manifest.json',
    name: 'manifest.json',
  });
  const projectFolder = getInstance(TFolder, {
    path: 'Steward/Widgets/chat-1/abc12',
    children: [indexFile, manifestFile],
  });

  return {
    settings: { stewardFolder: 'Steward' },
    app: {
      vault: {
        getFolderByPath: jest.fn((path: string) => {
          if (path === 'Steward/Widgets/chat-1/abc12') {
            return projectFolder;
          }
          return null;
        }),
        getFileByPath: jest.fn(),
        read: jest.fn(),
        modify: jest.fn(),
        create: jest.fn(),
      },
    },
    obsidianAPITools: {
      ensureFolderExists: jest.fn().mockResolvedValue(undefined),
      getFilesFromFolder: jest.fn().mockReturnValue([indexFile, manifestFile]),
    },
    registerEvent: jest.fn(),
    mediaTools: {
      findFileByNameOrPath: jest.fn(),
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('WidgetService', () => {
  beforeEach(() => {
    (WidgetService as unknown as { instance?: WidgetService }).instance = undefined;
  });

  describe('parseProjectFenceContent', () => {
    it('parses widgetId and projectPath from code block textContent', () => {
      const plugin = createMockPlugin();
      const service = WidgetService.getInstance(plugin);

      const body = `widgetId: l279k
projectPath: Steward/Widgets/General 2026-05-28_03-06-31/l279k
`;

      const parsed = service.parseProjectFenceContent(body);

      expect(parsed).toEqual({
        widgetId: 'l279k',
        projectPath: 'Steward/Widgets/General 2026-05-28_03-06-31/l279k',
      });
    });

    it('parses when widgetId and projectPath appear inside a larger message', () => {
      const plugin = createMockPlugin();
      const service = WidgetService.getInstance(plugin);

      const content = `Some text\nwidgetId: abc12\nprojectPath: Steward/Widgets/chat-1/abc12\nmore`;

      const parsed = service.parseProjectFenceContent(content);

      expect(parsed).toEqual({
        widgetId: 'abc12',
        projectPath: 'Steward/Widgets/chat-1/abc12',
      });
    });
  });

  describe('getProjectPath', () => {
    it('builds the project folder under the widgets root', () => {
      const plugin = createMockPlugin();
      const service = WidgetService.getInstance(plugin);

      const path = service.getProjectPath({
        conversationTitle: 'chat-1',
        widgetId: 'abc12',
      });

      expect(path).toBe('Steward/Widgets/chat-1/abc12');
    });
  });

  describe('listProjectFiles', () => {
    it('returns relative paths via obsidianAPITools.getFilesFromFolder', async () => {
      const plugin = createMockPlugin();
      const service = WidgetService.getInstance(plugin);

      const files = await service.listProjectFiles('Steward/Widgets/chat-1/abc12');

      expect(plugin.obsidianAPITools.getFilesFromFolder).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'Steward/Widgets/chat-1/abc12' }),
        { recursive: true }
      );
      expect(files).toEqual(['index.html', 'manifest.json']);
    });
  });
});
