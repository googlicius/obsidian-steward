import { IndexedDocument } from 'src/database/SearchDatabase';
import { ConditionResult } from './Condition';
import { Filter } from './Filter';

export class DocumentPropertyFilter extends Filter<IndexedDocument> {
  constructor(private properties: Array<{ name: string; value: unknown }>) {
    super();
  }

  async evaluate() {
    if (!this.prevConditionResult) {
      return new Map();
    }

    const resultMap = new Map<number, ConditionResult<IndexedDocument>>();
    const documentIds = Array.from(this.prevConditionResult.keys());

    const properties = await this.context.documentStore.properties
      .where('documentId')
      .anyOf(documentIds)
      .filter(prop => this.properties.some(p => p.name === prop.name && p.value === prop.value))
      .toArray();

    const documentIdsMap = properties
      .map(prop => prop.documentId)
      .reduce<Map<number, boolean>>((acc, prop) => {
        if (!acc.has(prop)) {
          acc.set(prop, true);
        }
        return acc;
      }, new Map());

    for (const [docId, result] of this.prevConditionResult) {
      if (documentIdsMap.has(docId)) {
        resultMap.set(docId, {
          document: result.document as IndexedDocument,
          score: 0, // We don't need to add score while filtering.
        });
      }
    }

    return resultMap;
  }
}
