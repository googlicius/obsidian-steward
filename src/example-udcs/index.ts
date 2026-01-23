/**
 * This file exports the selected example UDCs from the community-UDCs folder.
 * Add or remove imports here to control which example commands are included.
 */

// Import selected example UDC definitions
import askDefinition from '../../community-UDCs/ask.md';
import cleanUpDefinition from '../../community-UDCs/Clean up.md';

export interface ExampleUDC {
  name: string;
  definition: string;
}

/**
 * Selected example UDCs to be created when the Commands folder is empty.
 * To add more examples, import the .md file and add it to this array.
 */
export const EXAMPLE_UDCS: ExampleUDC[] = [
  { name: 'Ask', definition: askDefinition },
  // Add more example UDCs here:
  { name: 'Clean up', definition: cleanUpDefinition },
  // { name: formatName('word-processor'), definition: wordProcessorDefinition },
];
