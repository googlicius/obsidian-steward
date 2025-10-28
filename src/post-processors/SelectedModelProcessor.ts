import { MarkdownPostProcessor } from 'obsidian';
import { findTextNodesWithRegex } from 'src/utils/findTextNode';
import { SELECTED_MODEL_PATTERN, SELECTED_MODEL_PREFIX_PATTERN } from 'src/constants';

/**
 * Process selected model patterns (e.g., `m:openai:gpt-4` or `model:google:gemini`)
 * into span elements displaying the model ID with a friendly UI
 */
export function createSelectedModelProcessor(): MarkdownPostProcessor {
  return el => {
    // Early exit: Check if element contains the pattern before expensive DOM traversal
    const patternCheck = new RegExp(SELECTED_MODEL_PREFIX_PATTERN, 'i');
    if (!el.textContent?.match(patternCheck)) {
      return;
    }

    // Find all text nodes containing the pattern
    const textNodes = findTextNodesWithRegex(el, new RegExp(SELECTED_MODEL_PATTERN, 'gi'));
    if (textNodes.length === 0) return;

    for (const textNode of textNodes) {
      const replacementElements: (HTMLElement | Text)[] = [];
      const textContent = textNode.textContent || '';

      // Use matchAll to find all model patterns in the text
      const regex = new RegExp(SELECTED_MODEL_PATTERN, 'gi');
      let lastIndex = 0;
      let match;

      // Process all matches
      while ((match = regex.exec(textContent)) !== null) {
        // Add text before the match
        if (match.index > lastIndex) {
          const beforeText = textContent.substring(lastIndex, match.index);
          if (beforeText) {
            replacementElements.push(document.createTextNode(beforeText));
          }
        }

        // Create span for the matched model pattern
        const [, , provider, modelId] = match;
        const span = document.createElement('span');
        span.textContent = modelId;
        span.className = 'stw-selected-model review';
        span.title = `${provider}:${modelId}`;

        replacementElements.push(span);
        lastIndex = match.index + match[0].length;
      }

      // Add remaining text after the last match
      if (lastIndex < textContent.length) {
        const afterText = textContent.substring(lastIndex);
        if (afterText) {
          replacementElements.push(document.createTextNode(afterText));
        }
      }

      // Replace the original text node only if we created replacements
      if (replacementElements.length > 0) {
        textNode.replaceWith(...replacementElements);
      }
    }
  };
}
