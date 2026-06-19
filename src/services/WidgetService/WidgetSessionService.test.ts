import type StewardPlugin from 'src/main';
import { ToolName } from 'src/solutions/commands/ToolRegistry';
import { WidgetSessionService } from './WidgetSessionService';
import type { WidgetAgent } from './types';

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  return {
    widgetService: {
      getStatePresentation: jest.fn(),
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

function bindPrivateMethods(service: WidgetSessionService) {
  return {
    buildTurnContextStateSection: service['buildTurnContextStateSection'].bind(
      service
    ) as WidgetSessionService['buildTurnContextStateSection'],
    formatPresentationUnavailableNote: service['formatPresentationUnavailableNote'].bind(
      service
    ) as WidgetSessionService['formatPresentationUnavailableNote'],
    resolveActorTools: service['resolveActorTools'].bind(
      service
    ) as WidgetSessionService['resolveActorTools'],
  };
}

describe('WidgetSessionService turn context helpers', () => {
  let service: WidgetSessionService;
  let buildTurnContextStateSection: WidgetSessionService['buildTurnContextStateSection'];
  let formatPresentationUnavailableNote: WidgetSessionService['formatPresentationUnavailableNote'];
  let resolveActorTools: WidgetSessionService['resolveActorTools'];

  beforeEach(() => {
    (WidgetSessionService as unknown as { instance: WidgetSessionService | null }).instance = null;
    service = WidgetSessionService.getInstance(createMockPlugin());
    const bound = bindPrivateMethods(service);
    buildTurnContextStateSection = bound.buildTurnContextStateSection;
    formatPresentationUnavailableNote = bound.formatPresentationUnavailableNote;
    resolveActorTools = bound.resolveActorTools;
  });

  describe('buildTurnContextStateSection', () => {
    it('includes json and text views by default', () => {
      const lines = buildTurnContextStateSection({
        publicState: { board: ['X', null] },
        prefs: { includeJson: true, includePresentation: true },
        presentation: 'X | .',
      });

      expect(lines.join('\n')).toContain('```json');
      expect(lines.join('\n')).toContain('"X"');
      expect(lines.join('\n')).toContain('```text');
      expect(lines.join('\n')).toContain('X | .');
    });

    it('omits json when opted out', () => {
      const lines = buildTurnContextStateSection({
        publicState: { board: ['X'] },
        prefs: { includeJson: false, includePresentation: true },
        presentation: 'X | .',
      });

      expect(lines.join('\n')).not.toContain('```json');
      expect(lines.join('\n')).toContain('```text');
    });

    it('shows unavailable note when presentation is missing', () => {
      const lines = buildTurnContextStateSection({
        publicState: { board: ['X'] },
        prefs: { includeJson: true, includePresentation: true },
        presentationError: 'state_presentation_not_registered',
      });

      expect(lines.join('\n')).toContain('Text view unavailable');
    });
  });

  describe('formatPresentationUnavailableNote', () => {
    it('describes a missing presentation handler', () => {
      expect(formatPresentationUnavailableNote('state_presentation_not_registered')).toContain(
        'formatStateForModel'
      );
    });
  });

  describe('resolveActorTools', () => {
    it('always includes widget_action', () => {
      const tools = resolveActorTools(undefined);
      expect(tools).toContain(ToolName.WIDGET_ACTION);
    });

    it('includes tools from the agent block', () => {
      const agent: WidgetAgent = {
        name: 'agent',
        id: 'o',
        instructions: ['Play O'],
        actions: ['playCell'],
        tools: [ToolName.CONTENT_READING, ToolName.WIDGET_ACTION, ToolName.SEARCH],
      };

      const tools = resolveActorTools(agent);
      expect(tools).toContain(ToolName.WIDGET_ACTION);
      expect(tools).toContain(ToolName.CONTENT_READING);
      expect(tools).toContain(ToolName.SEARCH);
    });
  });
});
