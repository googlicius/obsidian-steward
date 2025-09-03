import { Condition, ConditionResult } from './Condition';

/**
 * Condition for filtering by properties.
 */
export class PropertyCondition extends Condition {
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

    // Store all matched document IDs across all properties
    const allMatchedDocIds: number[] = [];

    // Process each property
    for (const prop of propertiesToUse) {
      // Get documents matching this property
      const docs = await this.context.documentStore.getDocumentsByProperty(prop.name, prop.value);

      // Add document IDs to the combined list (OR logic)
      allMatchedDocIds.push(...docs.map(doc => doc.id as number));
    }

    // Remove duplicates and get unique document IDs
    const resultDocIds = [...new Set(allMatchedDocIds)];

    // If no documents match any properties, return empty map
    if (resultDocIds.length === 0) {
      return new Map();
    }

    // Get the actual documents
    const documents = await this.context.documentStore.getDocumentsByIds(resultDocIds);

    // Create result map with score 1 for all matching documents
    const result = new Map<number, ConditionResult>();
    for (const doc of documents) {
      result.set(doc.id as number, {
        document: doc,
        score: 1,
      });
    }

    return result;
  }
}
