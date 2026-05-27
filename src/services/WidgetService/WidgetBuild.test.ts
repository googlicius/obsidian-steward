import { buildWidgetSrcdoc, WIDGET_SRCDOC_HEAD } from './WidgetBuild';
import { WIDGET_RESIZE } from './WidgetProtocol';

describe('buildWidgetSrcdoc', () => {
  it('wraps an HTML fragment with CSP head and allow-scripts sandbox', () => {
    const result = buildWidgetSrcdoc({
      type: 'html',
      code: '<p>Hello</p>',
    });

    expect(result.sandbox).toBe('allow-scripts');
    expect(result.usesPostMessageResize).toBe(true);
    expect(result.srcdoc).toContain(WIDGET_SRCDOC_HEAD);
    expect(result.srcdoc).toContain('<p>Hello</p>');
    expect(result.srcdoc).toContain(WIDGET_RESIZE);
  });

  it('uses allow-same-origin for SVG without scripts', () => {
    const result = buildWidgetSrcdoc({
      type: 'svg',
      code: '<svg><circle r="5"/></svg>',
    });

    expect(result.sandbox).toBe('allow-same-origin');
    expect(result.usesPostMessageResize).toBe(false);
    expect(result.srcdoc).toContain('<circle r="5"/>');
  });

  it('injects head meta into a full HTML document', () => {
    const result = buildWidgetSrcdoc({
      type: 'html',
      code: '<!DOCTYPE html><html><head><title>T</title></head><body>Full</body></html>',
      extraHead: '<script>window.__EXTRA__ = 1;</script>',
    });

    expect(result.srcdoc).toContain('Content-Security-Policy');
    expect(result.srcdoc).toContain('window.__EXTRA__ = 1');
    expect(result.srcdoc).toContain('Full');
  });
});
