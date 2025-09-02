import { Condition, ConditionResult } from './Condition';

/**
 * Condition for filtering by properties.
 */
export class PropertyCondition extends Condition {
  constructor(private properties: Array<{ name: string; value: string }>) {
    super();
  }

  async evaluate(): Promise<Map<number, ConditionResult>> {
    if (this.properties.length === 0) {
      return new Map();
    }

    const specificProperties = this.properties.filter(
      prop => prop.name !== 'file_type' && prop.name !== 'file_category'
    );

    // Use specific properties if available, otherwise use all properties
    const propertiesToUse = specificProperties.length > 0 ? specificProperties : this.properties;

    // Store matched document IDs for each property
    const matchedDocIdsByProperty: number[][] = [];

    // Process each property
    for (const prop of propertiesToUse) {
      // Get documents matching this property
      const docs = await this.context.documentStore.getDocumentsByProperty(prop.name, prop.value);

      // If no documents match this property, return empty map (AND logic)
      if (docs.length === 0) {
        return new Map();
      }

      // Add document IDs to the matched list
      matchedDocIdsByProperty.push(docs.map(doc => doc.id as number));
    }

    // Find document IDs that match ALL properties (intersection)
    let resultDocIds: number[] = matchedDocIdsByProperty[0];

    for (let i = 1; i < matchedDocIdsByProperty.length; i++) {
      resultDocIds = resultDocIds.filter(id => matchedDocIdsByProperty[i].includes(id));
    }

    // If no documents match all properties, return empty map
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
