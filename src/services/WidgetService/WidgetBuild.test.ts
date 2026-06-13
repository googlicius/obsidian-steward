import { buildWidgetSrcdoc, buildWidgetStateHead, WIDGET_SRCDOC_HEAD } from './WidgetBuild';
import { WidgetMessageType, WIDGET_STATE_GLOBAL } from './WidgetProtocol';

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
    expect(result.srcdoc).toContain(WidgetMessageType.Resize);
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

describe('buildWidgetStateHead', () => {
  it('injects null state and window.stw bridge when no persisted state', () => {
    const head = buildWidgetStateHead({ state: null });

    expect(head).toContain(`window.${WIDGET_STATE_GLOBAL} = null`);
    expect(head).toContain('window.stw');
    expect(head).toContain(WidgetMessageType.StateSave);
  });

  it('serializes persisted state envelope into the iframe', () => {
    const head = buildWidgetStateHead({
      state: {
        version: 1,
        updatedAt: '2026-05-29T00:00:00.000Z',
        data: { cells: ['x', null, null] },
      },
    });

    expect(head).toContain('"cells":["x",null,null]');
    expect(head).toContain('getState');
    expect(head).toContain('setState');
  });

  it('injects manifest asset registry and async getAsset bridge on window.stw', () => {
    const head = buildWidgetStateHead({
      state: null,
      assets: { x: 'Images/x.png', 'Images/x.png': 'Images/x.png' },
    });

    expect(head).toContain('"x":"Images/x.png"');
    expect(head).toContain('getAsset');
    expect(head).toContain('assets:');
    expect(head).toContain(WidgetMessageType.AssetRequest);
    expect(head).toContain(WidgetMessageType.AssetResponse);
    expect(head).toContain('hydrateDomAssets');
  });

  it('exposes registerAction, dispatchAction, and action postMessage bridge', () => {
    const head = buildWidgetStateHead({ state: null });

    expect(head).toContain('registerAction');
    expect(head).toContain('dispatchAction');
    expect(head).toContain('getRegisteredActions');
    expect(head).toContain(WidgetMessageType.ApplyAction);
    expect(head).toContain(WidgetMessageType.ActionResult);
    expect(head).toContain(WidgetMessageType.ActionsRegistered);
  });
});
