import { IndexedProperty } from 'src/database/SearchDatabase';

/**
 * A specialized array for IndexedProperty objects that automatically
 * converts property names and string values to lowercase when items are pushed
 */
export class IndexedPropertyArray extends Array<IndexedProperty> {
  constructor(...items: IndexedProperty[]) {
    super();
    this.push(...items);
  }

  /**
   * Override push method to convert property names and string values to lowercase
   * @returns The new length of the array
   */
  push(...items: IndexedProperty[]): number {
    // Process each item before pushing
    const processedItems = items.map(item => {
      // Create a new object to avoid mutating the original
      const processedItem: IndexedProperty = { ...item };

      // Convert name to lowercase if it's a string
      if (typeof processedItem.name === 'string') {
        processedItem.name = processedItem.name.toLowerCase();
      }

      // Special handling for tag properties
      if (processedItem.name === 'tag' && typeof processedItem.value === 'string') {
        // Remove leading # if present for tag values
        processedItem.value = processedItem.value.replace(/^#/, '').toLowerCase();
      }
      // For non-tag properties, just convert to lowercase if it's a string
      else if (typeof processedItem.value === 'string') {
        processedItem.value = processedItem.value.toLowerCase();
      }

      return processedItem;
    });

    // Call the original push method with processed items
    return super.push(...processedItems);
  }
}
