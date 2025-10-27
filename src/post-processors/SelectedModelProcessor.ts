import { MarkdownPostProcessor } from 'obsidian';
import { findTextNodesWithRegex } from 'src/utils/findTextNode';
import { SELECTED_MODEL_PATTERN } from 'src/constants';

/**
 * Process selected model patterns (e.g., `m:openai:gpt-4` or `model:google:gemini`)
 * into span elements displaying the model ID with a friendly UI
 */
export function createSelectedModelProcessor(): MarkdownPostProcessor {
  return el => {
    // Early exit: Check if element contains the pattern before expensive DOM traversal
    const patternCheck = /\b(m|model):/;
    if (!el.textContent?.match(patternCheck)) {
      return;
    }

    // Find all text nodes containing the pattern
    const textNodes = findTextNodesWithRegex(el, new RegExp(SELECTED_MODEL_PATTERN, 'gi'));
    if (textNodes.length === 0) return;

    for (const textNode of textNodes) {
      const replacementElements: (HTMLElement | Text)[] = [];

      const textParts = textNode.textContent?.split(' ') || [];

      for (const textPart of textParts) {
        // Check if this part matches the pattern
        const match = textPart.match(new RegExp(SELECTED_MODEL_PATTERN));
        if (match) {
          const [, , provider, modelId] = match;
          const span = document.createElement('span');
          span.textContent = modelId;
          span.className = 'stw-selected-model review';
          span.title = `${provider}:${modelId}`;

          replacementElements.push(span);
        } else if (textPart) {
          // Only push non-empty text parts
          replacementElements.push(document.createTextNode(textPart));
        }
      }

      textNode.replaceWith(...replacementElements);
    }
  };
}
