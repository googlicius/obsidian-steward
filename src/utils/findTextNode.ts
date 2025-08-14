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
