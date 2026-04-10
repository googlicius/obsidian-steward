import { MarkdownPostProcessor } from 'obsidian';
import { CLI_STREAM_MARKER_REGEX } from 'src/services/CliSessionService/cliTranscriptMarker';
import { findTextNodesWithRegex } from 'src/utils/htmlElementUtils';

/**
 * Regex used only to locate text nodes; must not use the `g` flag so {@link findTextNodesWithRegex}
 * does not advance `lastIndex` across nodes.
 */
const CLI_STREAM_MARKER_REGEX_FOR_SEARCH = new RegExp(CLI_STREAM_MARKER_REGEX.source);

const CLI_STREAM_MARKER_REGEX_GLOBAL = new RegExp(CLI_STREAM_MARKER_REGEX.source, 'g');

function clearPreCursorUi(pre: HTMLElement): void {
  pre.classList.remove('stw-cli-transcript-active');
  const oldCursors = pre.querySelectorAll(':scope > .stw-cli-transcript-cursor');
  for (let i = 0; i < oldCursors.length; i++) {
    oldCursors[i].remove();
  }
}

function stripMarkersFromCode(code: HTMLElement): boolean {
  const textNodes = findTextNodesWithRegex(code, CLI_STREAM_MARKER_REGEX_FOR_SEARCH);
  let strippedAny = false;

  for (let j = 0; j < textNodes.length; j++) {
    const textNode = textNodes[j];
    if (!textNode.parentNode) {
      continue;
    }
    const before = textNode.textContent ?? '';
    CLI_STREAM_MARKER_REGEX_GLOBAL.lastIndex = 0;
    const after = before.replace(CLI_STREAM_MARKER_REGEX_GLOBAL, '');
    if (after === before) {
      continue;
    }
    strippedAny = true;
    if (after.length === 0) {
      textNode.remove();
    } else {
      textNode.textContent = after;
    }
  }

  return strippedAny;
}

/**
 * Hides the vault-only stream anchor inside ```cli-transcript``` blocks and shows a blinking cursor
 * on the ```pre``` while output is still being written. When the marker is removed from the note,
 * the block renders as plain text.
 */
export function createCliTranscriptPostProcessor(): MarkdownPostProcessor {
  return (el: HTMLElement) => {
    const blocks = el.querySelectorAll('pre > code.language-cli-transcript');
    for (let i = 0; i < blocks.length; i++) {
      const code = blocks[i] as HTMLElement;
      const pre = code.parentElement;
      if (!pre || pre.tagName !== 'PRE') {
        continue;
      }

      const raw = code.textContent ?? '';
      if (!CLI_STREAM_MARKER_REGEX.test(raw)) {
        clearPreCursorUi(pre);
        continue;
      }

      clearPreCursorUi(pre);
      const stripped = stripMarkersFromCode(code);
      if (!stripped) {
        continue;
      }

      pre.classList.add('stw-cli-transcript-active');
      const cursor = document.createElement('span');
      cursor.classList.add('stw-cli-transcript-cursor');
      cursor.setAttribute('aria-hidden', 'true');
      pre.appendChild(cursor);
    }
  };
}
