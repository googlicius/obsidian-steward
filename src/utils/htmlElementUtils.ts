import { setTooltip } from 'obsidian';

/**
 * Finds all text nodes containing the specified regex within a given HTMLElement.
 */
export function findTextNodesWithRegex(element: HTMLElement, regex: RegExp): Text[] {
  // Use a TreeWalker for efficient DOM traversal
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
  const matchingNodes: Text[] = [];

  let node;
  while ((node = walker.nextNode())) {
    if (node.textContent && regex.test(node.textContent)) {
      matchingNodes.push(node as Text);
    }
  }

  return matchingNodes;
}

/**
 * Append text to a fragment, converting newlines to <br> elements
 */
function appendTextWithLineBreaks(fragment: DocumentFragment, text: string): void {
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) {
      fragment.appendChild(document.createTextNode(lines[i]));
    }

    // Add <br> element between lines (not after the last line)
    if (i < lines.length - 1) {
      fragment.appendChild(document.createElement('br'));
    }
  }
}

/**
 * Parse text and create a DocumentFragment with clickable links
 * Links are detected using URL pattern and rendered as <a> elements
 */
export function createFragmentFromText(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();

  // URL regex pattern to match http, https URLs
  const urlPattern = /(https?:\/\/[^\s<>"\])}]+)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = urlPattern.exec(text)) !== null) {
    // Add text before the URL (with newline handling)
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index);
      appendTextWithLineBreaks(fragment, textBefore);
    }

    // Create the link element
    const url = match[1];
    const link = document.createElement('a');
    link.href = url;
    link.textContent = url;
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener');
    setTooltip(link, url);
    fragment.appendChild(link);

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after the last URL (with newline handling)
  if (lastIndex < text.length) {
    appendTextWithLineBreaks(fragment, text.slice(lastIndex));
  }

  return fragment;
}
