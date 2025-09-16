import { Condition, ConditionResult } from './Condition';
import { IndexedDocument } from 'src/database/SearchDatabase';

export class PropertyCondition extends Condition<IndexedDocument> {
  constructor(private properties: Array<{ name: string; value: unknown }>) {
    super();
  }

  async evaluate() {
    if (this.properties.length === 0) {
      return new Map();
    }

    // file_type and file_category are evaluated if there is no other properties.
    const otherProperties = this.properties.filter(
      prop => prop.name !== 'file_type' && prop.name !== 'file_category'
    );

    // Use specific properties if available, otherwise use all properties
    const propertiesToUse = otherProperties.length > 0 ? otherProperties : this.properties;

    const result = new Map<number, ConditionResult<IndexedDocument>>();

    for (const prop of propertiesToUse) {
      // Get documents matching this property
      const docs = await this.context.documentStore.getDocumentsByProperty(prop.name, prop.value);

      // Skip file_type and file_category from processing matching properties
      if (prop.name === 'file_type' || prop.name === 'file_category') {
        for (const doc of docs) {
          const docId = doc.id as number;

          if (!result.has(docId)) {
            result.set(docId, {
              document: doc,
              score: 1,
            });
          }
        }
        continue;
      }

      // Add documents to the result with their matched properties
      for (const doc of docs) {
        const docId = doc.id as number;

        const matchedProperties: string[] = [];

        if (prop.name === 'tag') {
          matchedProperties.push(`#${prop.value}`);
        } else {
          matchedProperties.push(`${prop.name}: ${prop.value}`);
        }

        if (result.has(docId)) {
          // Document already exists, add the property to matched properties
          const existing = result.get(docId);
          if (existing) {
            if (!existing.keywordsMatched) {
              existing.keywordsMatched = [];
            }
            existing.keywordsMatched.push(...matchedProperties);
          }
        } else {
          // New document, add to result
          result.set(docId, {
            document: doc,
            score: 1,
            keywordsMatched: matchedProperties,
          });
        }
      }
    }

    return result;
  }
}
