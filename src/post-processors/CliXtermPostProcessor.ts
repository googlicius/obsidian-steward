import { MarkdownPostProcessor, type MarkdownPostProcessorContext } from 'obsidian';
import type StewardPlugin from 'src/main';
import { CLI_XTERM_MARKER } from 'src/services/CliSessionService/constants';
import { getBundledLib } from 'src/utils/bundledLibs';
import { findTextNodesWithRegex } from 'src/utils/htmlElementUtils';

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

    const styleTarget =
      params.container.closest('.workspace-leaf-content') ?? document.documentElement;
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
    term.open(params.container);
    fitAddon.fit();
    term.focus();
    window.setTimeout(() => {
      term.focus();
    }, 0);

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
      fitAddon.fit();
      resizePty(term.cols, term.rows);
    });
    resizeObserver.observe(params.container);

    const cleanup = (): void => {
      onInputDisposable.dispose();
      resizeObserver.disconnect();
      session.child.stdout.removeListener('data', onStdout);
      session.child.stderr.removeListener('data', onStderr);
      term.dispose();
      delete params.container.dataset.stwCliXtermMounted;
    };

    const removalWatcher = new MutationObserver(() => {
      if (document.body.contains(params.container)) {
        return;
      }
      removalWatcher.disconnect();
      cleanup();
    });
    removalWatcher.observe(document.body, {
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
