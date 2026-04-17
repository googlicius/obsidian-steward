import { MarkdownPostProcessor } from 'obsidian';
import { CLI_STREAM_MARKER, getCliStreamMarkerPlaceholder } from 'src/services/CliSessionService/constants';
import { findTextNodesWithRegex } from 'src/utils/htmlElementUtils';

function clearPreCursorUi(pre: HTMLElement): void {
  pre.classList.remove('stw-cli-transcript-active');
  const oldCursors = pre.querySelectorAll(':scope > .stw-cli-transcript-cursor');
  for (let i = 0; i < oldCursors.length; i++) {
    oldCursors[i].remove();
  }
}

function stripMarkersFromCode(code: HTMLElement): boolean {
  const regexForSearch = new RegExp(CLI_STREAM_MARKER);
  const textNodes = findTextNodesWithRegex(code, regexForSearch);
  let strippedAny = false;

  for (let j = 0; j < textNodes.length; j++) {
    const textNode = textNodes[j];
    if (!textNode.parentNode) {
      continue;
    }
    const before = textNode.textContent ?? '';
    const regexGlobal = new RegExp(CLI_STREAM_MARKER, 'g');
    const after = before.replace(regexGlobal, '');
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
      const streamRegex = new RegExp(CLI_STREAM_MARKER);
      if (!streamRegex.test(raw)) {
        clearPreCursorUi(pre);
        continue;
      }

      clearPreCursorUi(pre);
      const stripped = stripMarkersFromCode(code);
      if (!stripped) {
        continue;
      }

      if (!raw.includes(getCliStreamMarkerPlaceholder())) {
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
