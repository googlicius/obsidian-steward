import type StewardPlugin from 'src/main';
import { WidgetSessionService } from './WidgetSessionService';

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  return {
    widgetService: {
      getStatePresentation: jest.fn(),
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('WidgetSessionService turn context helpers', () => {
  let service: WidgetSessionService;
  let buildTurnContextStateSection: WidgetSessionService['buildTurnContextStateSection'];
  let formatPresentationUnavailableNote: WidgetSessionService['formatPresentationUnavailableNote'];

  beforeEach(() => {
    (WidgetSessionService as unknown as { instance: WidgetSessionService | null }).instance = null;
    service = WidgetSessionService.getInstance(createMockPlugin());
    buildTurnContextStateSection = service['buildTurnContextStateSection'].bind(service);
    formatPresentationUnavailableNote = service['formatPresentationUnavailableNote'].bind(service);
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
});
