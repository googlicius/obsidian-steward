/**
 * Sets up auto-scroll to bottom for a scrollable container.
 * Uses a MutationObserver to keep the element scrolled to the bottom as content changes.
 * Useful during streaming to keep the latest content in view.
 */
export function setupAutoScroll(el: HTMLElement): void {
  const scrollToBottom = () => {
    el.scrollTop = el.scrollHeight;
  };

  scrollToBottom();

  const observer = new MutationObserver(scrollToBottom);
  observer.observe(el, { childList: true, subtree: true, characterData: true });
}

/**
 * Returns true if the user has selected text that intersects the given element.
 * Used to avoid collapsing/expanding when the user is selecting text.
 */
export function hasSelectedTextInElement(el: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  if (!selection.toString().trim()) return false;

  const range = selection.getRangeAt(0);
  return range.intersectsNode(el);
}
