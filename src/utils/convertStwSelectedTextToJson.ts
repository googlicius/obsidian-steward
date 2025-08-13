import { STW_SELECTED_METADATA_PATTERN, STW_SELECTED_PATTERN } from 'src/constants';
import { unescapeMarkdown } from './markdownUtils';

export function convertStwSelectedTextToJson(userInput: string): string[] {
  if (!userInput.includes('{{stw-selected')) {
    return [];
  }

  const stwSelectedMatch = userInput.match(new RegExp(STW_SELECTED_PATTERN, 'g'));
  if (!stwSelectedMatch) {
    return [];
  }

  return stwSelectedMatch.map(match => {
    const [, fromLine, toLine, escapedSelection, noteName] =
      match.match(new RegExp(STW_SELECTED_METADATA_PATTERN)) || [];
    return JSON.stringify({
      noteName,
      fromLine,
      toLine,
      selection: unescapeMarkdown(escapedSelection),
    });
  });
}
