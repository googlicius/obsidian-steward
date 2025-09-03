import { Condition, ConditionResult } from './Condition';
import { IndexedDocument } from 'src/database/SearchDatabase';

/**
 * Condition for filtering by properties.
 */
export class PropertyCondition extends Condition<IndexedDocument> {
  constructor(private properties: Array<{ name: string; value: string }>) {
    super();
  }

  async evaluate() {
    if (this.properties.length === 0) {
      return new Map();
    }

    const specificProperties = this.properties.filter(
      prop => prop.name !== 'file_type' && prop.name !== 'file_category'
    );

    // Use specific properties if available, otherwise use all properties
    const propertiesToUse = specificProperties.length > 0 ? specificProperties : this.properties;

    // Store matched documents with their associated properties for highlighting
    const documentsMap = new Map<number, { doc: IndexedDocument; matchedProperties: string[] }>();

    // Process each property
    for (const prop of propertiesToUse) {
      // Get documents matching this property
      const docs = await this.context.documentStore.getDocumentsByProperty(prop.name, prop.value);

      // Skip file type and file category properties
      if (prop.name === 'file_type' || prop.name === 'file_category') {
        continue;
      }

      // Add documents to the map with their matched properties
      for (const doc of docs) {
        const docId = doc.id as number;

        const matchedProperties: string[] = [];

        if (prop.name === 'tag') {
          matchedProperties.push(`#${prop.value}`);
        } else {
          matchedProperties.push(`${prop.name}: ${prop.value}`);
        }

        if (documentsMap.has(docId)) {
          // Document already exists, add the property to matched properties
          const existing = documentsMap.get(docId);
          if (existing) {
            existing.matchedProperties.push(...matchedProperties);
          }
        } else {
          // New document, add to map
          documentsMap.set(docId, {
            doc,
            matchedProperties: matchedProperties,
          });
        }
      }
    }

    // If no documents match any properties, return empty map
    if (documentsMap.size === 0) {
      return new Map();
    }

    // Create result map with score 1 for all matching documents
    const result = new Map<number, ConditionResult<IndexedDocument>>();
    for (const [docId, { doc, matchedProperties }] of documentsMap) {
      result.set(docId, {
        document: doc,
        score: 1,
        keywordsMatched: matchedProperties,
      });
    }

    return result;
  }
}
