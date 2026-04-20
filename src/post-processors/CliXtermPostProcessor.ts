import { MarkdownPostProcessor, type MarkdownPostProcessorContext } from 'obsidian';
import type { Terminal } from '@xterm/xterm';
import type StewardPlugin from 'src/main';
import { CLI_XTERM_MARKER } from 'src/services/CliSessionService/constants';
import { getBundledLib } from 'src/utils/bundledLibs';
import { findTextNodesWithRegex } from 'src/utils/htmlElementUtils';

/** Fixed row count for the xterm viewport. `FitAddon` is still used for cols. */
// const CLI_XTERM_DEFAULT_ROWS = 30;

/** Total scroll extent for the outer (Obsidian) scroller: one CSS pixel per buffer line. */
function updateCliXtermScrollWrapHeight(params: {
  term: Terminal;
  scrollWrap: HTMLElement;
  xtermHost: HTMLElement;
}): void {
  const rowPx = measureCliXtermRowPx({
    xtermHost: params.xtermHost,
    terminalRows: params.term.rows,
  });
  if (rowPx <= 0) {
    return;
  }
  const lineCount = params.term.buffer.active.length;
  params.scrollWrap.style.height = `${lineCount * rowPx}px`;
}

function measureCliXtermRowPx(params: { xtermHost: HTMLElement; terminalRows: number }): number {
  const firstRow = params.xtermHost.querySelector('.xterm-rows > div');
  if (firstRow instanceof HTMLElement) {
    const h = firstRow.getBoundingClientRect().height;
    if (h > 0) {
      return h;
    }
  }
  if (params.terminalRows > 0) {
    const xtermRoot = params.xtermHost.querySelector('.xterm');
    if (xtermRoot instanceof HTMLElement) {
      const h = xtermRoot.getBoundingClientRect().height;
      if (h > 0) {
        return h / params.terminalRows;
      }
    }
  }
  return 0;
}

/** Walks up the DOM to find the first vertically-scrollable ancestor. */
function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let parent: HTMLElement | null = el.parentElement;
  while (parent && parent !== document.body) {
    const style = window.getComputedStyle(parent);
    if (/(auto|scroll|overlay)/.test(style.overflowY)) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

/**
 * Two-way scroll sync between the editor's scroller and xterm's viewport:
 *   - editor scroll → `term.scrollLines(delta)` so xterm's visible content
 *     matches the sticky translate.
 *   - `term.onScroll` (new output, programmatic scroll) → scroll the editor
 *     by the matching delta so the sticky translate stays aligned with
 *     `buffer.active.viewportY * rowPx`.
 * A pair of flags prevents the two directions from chasing each other.
 */
function setupCliXtermScrollSync(params: {
  term: Terminal;
  scrollWrap: HTMLElement;
  xtermHost: HTMLElement;
  invalidateCache: () => void;
}): { teardown: () => void; invalidateCache: () => void } {
  const scrollParent = findScrollableAncestor(params.scrollWrap);
  if (!scrollParent) {
    return { teardown: () => undefined, invalidateCache: () => undefined };
  }

  let applyingToTerm = false;
  // Counter instead of boolean: incremented before each scrollBy, decremented
  // in a rAF after the resulting scroll event has fired, so concurrent
  // xterm→editor scrolls do not clear the guard too early.
  let editorScrollGuard = 0;

  // ── cached measurements ──────────────────────────────────────────────────
  // rowPx and wrapOffsetTop are stable between resizes; recomputed only in
  // the ResizeObserver callback via invalidateCache().
  let cachedRowPx = 0;
  let cachedWrapOffsetTop = 0; // scrollWrap top relative to scrollParent top

  const computeWrapOffsetTop = (): number => {
    const wrapRect = params.scrollWrap.getBoundingClientRect();
    const parentRect = scrollParent.getBoundingClientRect();
    return wrapRect.top - parentRect.top + scrollParent.scrollTop;
  };

  const invalidateCache = (): void => {
    cachedRowPx = measureCliXtermRowPx({
      xtermHost: params.xtermHost,
      terminalRows: params.term.rows,
    });
    cachedWrapOffsetTop = computeWrapOffsetTop();
  };
  invalidateCache();
  // ─────────────────────────────────────────────────────────────────────────

  const onEditorScroll = (): void => {
    if (editorScrollGuard > 0) {
      return;
    }
    if (cachedRowPx <= 0) {
      return;
    }
    const scrolled = scrollParent.scrollTop - cachedWrapOffsetTop;
    const maxScrollback = Math.max(0, params.term.buffer.active.length - params.term.rows);
    const targetLine = Math.min(Math.max(Math.round(scrolled / cachedRowPx), 0), maxScrollback);
    const delta = targetLine - params.term.buffer.active.viewportY;
    if (delta === 0) {
      return;
    }
    applyingToTerm = true;
    params.term.scrollLines(delta);
    applyingToTerm = false;
  };

  const offTermScroll = params.term.onScroll(() => {
    if (applyingToTerm) {
      return;
    }
    if (cachedRowPx <= 0) {
      return;
    }
    const desiredScrollTop =
      cachedWrapOffsetTop + params.term.buffer.active.viewportY * cachedRowPx;
    const scrollDelta = desiredScrollTop - scrollParent.scrollTop;
    if (Math.abs(scrollDelta) < 0.5) {
      return;
    }
    editorScrollGuard += 1;
    scrollParent.scrollBy({ top: scrollDelta });
    // scrollBy fires the scroll event asynchronously; defer the decrement
    // until after that event has been processed so onEditorScroll ignores it.
    window.requestAnimationFrame(() => {
      editorScrollGuard = Math.max(0, editorScrollGuard - 1);
    });
  });

  scrollParent.addEventListener('scroll', onEditorScroll, { passive: true });

  return {
    teardown: () => {
      offTermScroll.dispose();
      scrollParent.removeEventListener('scroll', onEditorScroll);
    },
    invalidateCache,
  };
}

function readCssVariable(target: Element, variableName: string, fallback: string): string {
  const value = window.getComputedStyle(target).getPropertyValue(variableName).trim();
  if (value.length > 0) {
    return value;
  }
  return fallback;
}

function extractSourceConversationTitle(sourcePath: string): string {
  const filename = sourcePath.split('/').pop() ?? sourcePath;
  return filename.replace(/\.md$/i, '');
}

function resolveSessionTitle(params: {
  plugin: StewardPlugin;
  ctx: MarkdownPostProcessorContext;
}): { sessionTitle: string; hostConversationTitle: string | null } {
  const sourcePath = params.ctx.sourcePath;
  const sourceFile = params.plugin.app.vault.getFileByPath(sourcePath);
  if (!sourceFile) {
    return {
      sessionTitle: extractSourceConversationTitle(sourcePath),
      hostConversationTitle: null,
    };
  }

  const cache = params.plugin.app.metadataCache.getFileCache(sourceFile);
  const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
  const session =
    typeof frontmatter.session === 'string' && frontmatter.session.trim().length > 0
      ? frontmatter.session.trim()
      : '';
  const host =
    typeof frontmatter.host_conversation === 'string' &&
    frontmatter.host_conversation.trim().length > 0
      ? frontmatter.host_conversation.trim()
      : null;

  if (session.length > 0) {
    return { sessionTitle: session, hostConversationTitle: host };
  }

  return {
    sessionTitle: sourceFile.basename,
    hostConversationTitle: host,
  };
}

async function mountInteractiveTerminal(params: {
  plugin: StewardPlugin;
  container: HTMLElement;
  sessionTitle: string;
  hostConversationTitle: string | null;
}): Promise<void> {
  if (params.container.dataset.stwCliXtermMounted === '1') {
    return;
  }
  if (params.container.dataset.stwCliXtermMounting === '1') {
    return;
  }
  if (!params.container.isConnected) {
    const retries = Number(params.container.dataset.stwCliXtermRetryCount ?? '0');
    if (retries >= 80) {
      return;
    }
    params.container.dataset.stwCliXtermRetryCount = String(retries + 1);
    window.setTimeout(() => {
      void mountInteractiveTerminal(params);
    }, 50);
    return;
  }

  const directSession = params.plugin.cliSessionService.getSession(params.sessionTitle);
  const hostSession = params.hostConversationTitle
    ? params.plugin.cliSessionService.getSession(params.hostConversationTitle)
    : undefined;
  const session = directSession ?? hostSession;
  if (!session || session.cliMode !== 'interactive') {
    const retries = Number(params.container.dataset.stwCliXtermRetryCount ?? '0');
    if (retries >= 80) {
      delete params.container.dataset.stwCliXtermMounting;
      return;
    }
    params.container.dataset.stwCliXtermRetryCount = String(retries + 1);
    params.container.dataset.stwCliXtermMounting = '1';
    window.setTimeout(() => {
      delete params.container.dataset.stwCliXtermMounting;
      void mountInteractiveTerminal(params);
    }, 120);
    return;
  }

  params.container.dataset.stwCliXtermMounted = '1';
  delete params.container.dataset.stwCliXtermMounting;
  delete params.container.dataset.stwCliXtermRetryCount;

  try {
    const xtermLib = await getBundledLib('xterm');
    const fitLib = await getBundledLib('xtermAddonFit');

    const styleTarget = params.container.closest('.workspace-leaf') ?? document.documentElement;
    const background = readCssVariable(styleTarget, '--background-primary', '#1e1e1e');
    const foreground = readCssVariable(styleTarget, '--text-normal', '#dddddd');
    const selectionBackground = readCssVariable(
      styleTarget,
      '--background-modifier-hover',
      'rgba(255, 255, 255, 0.2)'
    );
    const monoFont = readCssVariable(
      styleTarget,
      '--font-monospace',
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    );

    const term = new xtermLib.Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: monoFont,
      theme: {
        background,
        foreground,
        cursor: foreground,
        cursorAccent: background,
        selectionBackground,
      },
    });
    const fitAddon = new fitLib.FitAddon();
    term.loadAddon(fitAddon);

    const scrollWrap = document.createElement('div');
    scrollWrap.className = 'stw-cli-xterm-scroll-wrap';
    const xtermHost = document.createElement('div');
    xtermHost.className = 'stw-cli-xterm-host';
    scrollWrap.appendChild(xtermHost);
    params.container.appendChild(scrollWrap);

    /** Runs fit to compute cols, then forces row count back to `CLI_XTERM_DEFAULT_ROWS`. */
    // const fitColsKeepRows = (): void => {
    //   fitAddon.fit();
    //   if (term.rows !== CLI_XTERM_DEFAULT_ROWS) {
    //     term.resize(term.cols, CLI_XTERM_DEFAULT_ROWS);
    //   }
    // };

    term.open(xtermHost);
    // fitColsKeepRows();
    term.focus();

    let heightRafPending = false;
    const refreshScrollWrapHeight = (): void => {
      if (heightRafPending) {
        return;
      }
      heightRafPending = true;
      window.requestAnimationFrame(() => {
        heightRafPending = false;
        updateCliXtermScrollWrapHeight({ term, scrollWrap, xtermHost });
      });
    };
    refreshScrollWrapHeight();

    const offWriteParsed = term.onWriteParsed(() => {
      refreshScrollWrapHeight();
      const buf = term.buffer.active;
      if (buf.viewportY >= buf.baseY) {
        term.scrollToLine(buf.baseY);
      }
    });

    let invalidateSyncCache = (): void => undefined;
    const scrollSync = setupCliXtermScrollSync({
      term,
      scrollWrap,
      xtermHost,
      invalidateCache: () => invalidateSyncCache(),
    });
    invalidateSyncCache = scrollSync.invalidateCache;

    const resizePty = (cols: number, rows: number): void => {
      const childWithResize = session.child as {
        resize?: (nextCols: number, nextRows: number) => void;
      };
      if (typeof childWithResize.resize !== 'function') {
        return;
      }
      childWithResize.resize(cols, rows);
    };
    resizePty(term.cols, term.rows);

    if (session.ptyScrollback.length > 0) {
      term.write(session.ptyScrollback);
      // After ptyScrollback is fully parsed the wrap height has been updated
      // (via onWriteParsed → rAF). A second rAF ensures we run after that
      // rAF completes so the wrap is tall enough before the scroll sync
      // pushes the editor scroller down to show the cursor.
      window.requestAnimationFrame(() => {
        term.scrollToLine(term.buffer.active.baseY);
      });
    }

    const onStdout = (chunk: string): void => {
      if (typeof chunk !== 'string' || chunk.length === 0) {
        return;
      }
      term.write(chunk);
    };
    const onStderr = (chunk: string): void => {
      if (typeof chunk !== 'string' || chunk.length === 0) {
        return;
      }
      term.write(chunk);
    };
    const onInputDisposable = term.onData(data => {
      session.child.stdin.write(data);
    });

    session.child.stdout.on('data', onStdout);
    session.child.stderr.on('data', onStderr);

    const resizeObserver = new ResizeObserver(() => {
      // fitColsKeepRows();
      resizePty(term.cols, term.rows);
      refreshScrollWrapHeight();
      invalidateSyncCache();
    });
    resizeObserver.observe(params.container);

    const cleanup = (): void => {
      onInputDisposable.dispose();
      offWriteParsed.dispose();
      scrollSync.teardown();
      resizeObserver.disconnect();
      session.child.stdout.removeListener('data', onStdout);
      session.child.stderr.removeListener('data', onStderr);
      term.dispose();
      delete params.container.dataset.stwCliXtermMounted;
    };

    // Watch only the containing leaf instead of all of document.body to
    // avoid the MutationObserver firing on every DOM change in the app.
    const observerRoot =
      params.container.closest('.workspace-leaf-content') ??
      params.container.closest('.workspace-leaf') ??
      document.body;
    const removalWatcher = new MutationObserver(() => {
      if (observerRoot.contains(params.container)) {
        return;
      }
      removalWatcher.disconnect();
      cleanup();
    });
    removalWatcher.observe(observerRoot, {
      childList: true,
      subtree: true,
    });
  } catch {
    delete params.container.dataset.stwCliXtermMounted;
  }
}

export function createCliXtermPostProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  return (el, ctx) => {
    if (!el.textContent?.includes(CLI_XTERM_MARKER)) {
      return;
    }

    const textNodes = findTextNodesWithRegex(el, /\{\{stw-cli-xterm\}\}/g);
    if (textNodes.length === 0) {
      return;
    }

    const sessionInfo = resolveSessionTitle({
      plugin,
      ctx,
    });

    for (let i = 0; i < textNodes.length; i++) {
      const textNode = textNodes[i];
      if (!textNode.parentNode) {
        continue;
      }

      const content = textNode.textContent ?? '';
      if (!content.includes(CLI_XTERM_MARKER)) {
        continue;
      }

      const replacementNodes: Array<HTMLElement | Text> = [];
      const markerIndex = content.indexOf(CLI_XTERM_MARKER);

      const before = content.slice(0, markerIndex);
      if (before.length > 0) {
        replacementNodes.push(document.createTextNode(before));
      }

      const container = document.createElement('div');
      container.classList.add('stw-cli-xterm');
      replacementNodes.push(container);

      const after = content.slice(markerIndex + CLI_XTERM_MARKER.length);
      if (after.length > 0) {
        replacementNodes.push(document.createTextNode(after));
      }

      textNode.replaceWith(...replacementNodes);

      void mountInteractiveTerminal({
        plugin,
        container,
        sessionTitle: sessionInfo.sessionTitle,
        hostConversationTitle: sessionInfo.hostConversationTitle,
      });
    }
  };
}
