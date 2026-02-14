import 'fake-indexeddb/auto';
import { DocumentStore } from './documentStore';
import { IndexedDocument, IndexedProperty } from '../../database/SearchDatabase';
import type { App } from 'obsidian';

/**
 * Creates a minimal mock App object for testing.
 */
function createMockApp(): App {
  return {
    vault: {
      configDir: '.obsidian',
    },
  } as unknown as App;
}

/**
 * Creates a DocumentStore with a unique DB name to isolate tests.
 */
function createStore(testName: string): DocumentStore {
  return new DocumentStore({
    app: createMockApp(),
    dbName: `test_${testName}_${Date.now()}`,
    excludeFolders: [],
  });
}

/**
 * Helper to seed documents and their properties into the store.
 * Returns the document IDs for reference.
 */
async function seedDocumentsWithProperties(
  store: DocumentStore,
  entries: Array<{
    doc: Omit<IndexedDocument, 'id'>;
    properties: Array<{ name: string; value: unknown }>;
  }>
): Promise<number[]> {
  const ids: number[] = [];

  for (const entry of entries) {
    const docId = await store.storeDocument(entry.doc as IndexedDocument);
    ids.push(docId);

    if (entry.properties.length > 0) {
      const props: IndexedProperty[] = entry.properties.map(p => ({
        documentId: docId,
        name: p.name.toLowerCase(),
        value: typeof p.value === 'string' ? p.value.toLowerCase() : p.value,
      }));
      await store.storeProperties(props);
    }
  }

  return ids;
}

describe('DocumentStore', () => {
  describe('getDocumentsByProperty', () => {
    let store: DocumentStore;
    let docIds: number[];

    beforeEach(async () => {
      store = createStore('getDocsByProp');
      docIds = await seedDocumentsWithProperties(store, [
        {
          doc: { path: 'notes/alpha.md', fileName: 'alpha', lastModified: 1000, tags: [] },
          properties: [
            { name: 'status', value: 'completed' },
            { name: 'priority', value: 3 },
            { name: 'tag', value: 'journal' },
          ],
        },
        {
          doc: { path: 'notes/beta.md', fileName: 'beta', lastModified: 2000, tags: [] },
          properties: [
            { name: 'status', value: 'in-progress' },
            { name: 'priority', value: 5 },
            { name: 'tag', value: 'project' },
          ],
        },
        {
          doc: { path: 'notes/gamma.md', fileName: 'gamma', lastModified: 3000, tags: [] },
          properties: [
            { name: 'status', value: 'completed' },
            { name: 'priority', value: 1 },
            { name: 'tag', value: 'journal' },
          ],
        },
      ]);
    });

    it('should find documents by string property (exact match)', async () => {
      const results = await store.getDocumentsByProperty('status', 'completed');

      expect(results).toHaveLength(2);
      const paths = results.map(d => d.path).sort();
      expect(paths).toEqual(['notes/alpha.md', 'notes/gamma.md']);
    });

    it('should find documents by numeric property', async () => {
      const results = await store.getDocumentsByProperty('priority', 5);

      expect(results).toHaveLength(1);
      expect(results[0].path).toBe('notes/beta.md');
    });

    it('should handle type coercion: query string "3" matches stored number 3', async () => {
      const results = await store.getDocumentsByProperty('priority', '3');

      expect(results).toHaveLength(1);
      expect(results[0].path).toBe('notes/alpha.md');
    });

    it('should handle type coercion: query number 5 matches stored number 5', async () => {
      const results = await store.getDocumentsByProperty('priority', 5);

      expect(results).toHaveLength(1);
      expect(results[0].path).toBe('notes/beta.md');
    });

    it('should be case-insensitive for property names', async () => {
      const results = await store.getDocumentsByProperty('Status', 'completed');

      expect(results).toMatchObject([
        {
          path: 'notes/alpha.md',
        },
        {
          path: 'notes/gamma.md',
        },
      ]);
    });

    it('should return empty array when no documents match', async () => {
      const results = await store.getDocumentsByProperty('status', 'archived');

      expect(results).toHaveLength(0);
    });

    it('should return empty array for non-existent property name', async () => {
      const results = await store.getDocumentsByProperty('nonexistent', 'value');

      expect(results).toHaveLength(0);
    });

    it('should return unique documents even if multiple properties match', async () => {
      // Add a duplicate property entry (same name+value for same doc)
      await store.storeProperties([{ documentId: docIds[0], name: 'tag', value: 'journal' }]);

      const results = await store.getDocumentsByProperty('tag', 'journal');

      // Should still be 2 unique documents (alpha and gamma), not 3
      expect(results).toHaveLength(2);
      const paths = results.map(d => d.path).sort();
      expect(paths).toEqual(['notes/alpha.md', 'notes/gamma.md']);
    });
  });

  describe('getDocumentsByPropertyWithOperator', () => {
    let store: DocumentStore;

    beforeEach(async () => {
      store = createStore('getDocsByPropOp');
      await seedDocumentsWithProperties(store, [
        {
          doc: { path: 'notes/low.md', fileName: 'low', lastModified: 1000, tags: [] },
          properties: [{ name: 'priority', value: 1 }],
        },
        {
          doc: { path: 'notes/medium.md', fileName: 'medium', lastModified: 2000, tags: [] },
          properties: [{ name: 'priority', value: 3 }],
        },
        {
          doc: { path: 'notes/high.md', fileName: 'high', lastModified: 3000, tags: [] },
          properties: [{ name: 'priority', value: 5 }],
        },
        {
          doc: { path: 'notes/top.md', fileName: 'top', lastModified: 4000, tags: [] },
          properties: [{ name: 'priority', value: 10 }],
        },
      ]);
    });

    it('should delegate "==" operator to getDocumentsByProperty', async () => {
      const results = await store.getDocumentsByPropertyWithOperator('priority', 3, '==');

      expect(results).toHaveLength(1);
      expect(results[0].path).toBe('notes/medium.md');
    });

    it('should find documents with ">" operator', async () => {
      const results = await store.getDocumentsByPropertyWithOperator('priority', 3, '>');

      expect(results).toHaveLength(2);
      const paths = results.map(d => d.path).sort();
      expect(paths).toEqual(['notes/high.md', 'notes/top.md']);
    });

    it('should find documents with ">=" operator', async () => {
      const results = await store.getDocumentsByPropertyWithOperator('priority', 3, '>=');

      expect(results).toHaveLength(3);
      const paths = results.map(d => d.path).sort();
      expect(paths).toEqual(['notes/high.md', 'notes/medium.md', 'notes/top.md']);
    });

    it('should find documents with "<" operator', async () => {
      const results = await store.getDocumentsByPropertyWithOperator('priority', 5, '<');

      expect(results).toHaveLength(2);
      const paths = results.map(d => d.path).sort();
      expect(paths).toEqual(['notes/low.md', 'notes/medium.md']);
    });

    it('should find documents with "<=" operator', async () => {
      const results = await store.getDocumentsByPropertyWithOperator('priority', 5, '<=');

      expect(results).toHaveLength(3);
      const paths = results.map(d => d.path).sort();
      expect(paths).toEqual(['notes/high.md', 'notes/low.md', 'notes/medium.md']);
    });

    it('should find documents with "!=" operator', async () => {
      const results = await store.getDocumentsByPropertyWithOperator('priority', 3, '!=');

      expect(results).toHaveLength(3);
      const paths = results.map(d => d.path).sort();
      expect(paths).toEqual(['notes/high.md', 'notes/low.md', 'notes/top.md']);
    });

    it('should handle string numeric value for range operators', async () => {
      const results = await store.getDocumentsByPropertyWithOperator('priority', '3', '>');

      expect(results).toHaveLength(2);
      const paths = results.map(d => d.path).sort();
      expect(paths).toEqual(['notes/high.md', 'notes/top.md']);
    });

    it('should return empty array for non-numeric value with range operator', async () => {
      const results = await store.getDocumentsByPropertyWithOperator(
        'priority',
        'not-a-number',
        '>'
      );

      expect(results).toHaveLength(0);
    });

    it('should return empty array when no documents match the operator', async () => {
      const results = await store.getDocumentsByPropertyWithOperator('priority', 100, '<');

      // All values (1, 3, 5, 10) are less than 100
      expect(results).toHaveLength(4);

      const noneResults = await store.getDocumentsByPropertyWithOperator('priority', 0, '<');
      expect(noneResults).toHaveLength(0);
    });

    it('should be case-insensitive for property names', async () => {
      const results = await store.getDocumentsByPropertyWithOperator('Priority', 3, '>');

      expect(results).toHaveLength(2);
    });

    it('should return empty array for non-existent property with range operator', async () => {
      const results = await store.getDocumentsByPropertyWithOperator('nonexistent', 5, '>');

      expect(results).toHaveLength(0);
    });
  });

  describe('getDocumentsByPropertyWithOperator - Date & Time', () => {
    let store: DocumentStore;

    beforeEach(async () => {
      store = createStore('getDocsByPropOpDate');
      await seedDocumentsWithProperties(store, [
        {
          doc: { path: 'notes/jan.md', fileName: 'jan', lastModified: 1000, tags: [] },
          properties: [{ name: 'created', value: '2024-01-15' }],
        },
        {
          doc: { path: 'notes/mar.md', fileName: 'mar', lastModified: 2000, tags: [] },
          properties: [{ name: 'created', value: '2024-03-20' }],
        },
        {
          doc: { path: 'notes/jun.md', fileName: 'jun', lastModified: 3000, tags: [] },
          properties: [{ name: 'created', value: '2024-06-01' }],
        },
        {
          doc: { path: 'notes/dec.md', fileName: 'dec', lastModified: 4000, tags: [] },
          properties: [{ name: 'created', value: '2024-12-25' }],
        },
      ]);
    });

    it('should find documents with ">" on date-only values', async () => {
      const results = await store.getDocumentsByPropertyWithOperator(
        'created',
        '2024-03-20',
        '>'
      );

      expect(results).toHaveLength(2);
      const paths = results.map(d => d.path).sort();
      expect(paths).toEqual(['notes/dec.md', 'notes/jun.md']);
    });

    it('should find documents with ">=" on date-only values', async () => {
      const results = await store.getDocumentsByPropertyWithOperator(
        'created',
        '2024-03-20',
        '>='
      );

      expect(results).toHaveLength(3);
      const paths = results.map(d => d.path).sort();
      expect(paths).toEqual(['notes/dec.md', 'notes/jun.md', 'notes/mar.md']);
    });

    it('should find documents with "<" on date-only values', async () => {
      const results = await store.getDocumentsByPropertyWithOperator(
        'created',
        '2024-06-01',
        '<'
      );

      expect(results).toHaveLength(2);
      const paths = results.map(d => d.path).sort();
      expect(paths).toEqual(['notes/jan.md', 'notes/mar.md']);
    });

    it('should find documents with "<=" on date-only values', async () => {
      const results = await store.getDocumentsByPropertyWithOperator(
        'created',
        '2024-06-01',
        '<='
      );

      expect(results).toHaveLength(3);
      const paths = results.map(d => d.path).sort();
      expect(paths).toEqual(['notes/jan.md', 'notes/jun.md', 'notes/mar.md']);
    });

    it('should find documents with "!=" on date-only values', async () => {
      const results = await store.getDocumentsByPropertyWithOperator(
        'created',
        '2024-03-20',
        '!='
      );

      expect(results).toHaveLength(3);
      const paths = results.map(d => d.path).sort();
      expect(paths).toEqual(['notes/dec.md', 'notes/jan.md', 'notes/jun.md']);
    });

    it('should return all documents when querying ">" with a date before all entries', async () => {
      const results = await store.getDocumentsByPropertyWithOperator(
        'created',
        '2023-12-31',
        '>'
      );

      expect(results).toHaveLength(4);
    });

    it('should return empty array when querying ">" with a date after all entries', async () => {
      const results = await store.getDocumentsByPropertyWithOperator(
        'created',
        '2025-01-01',
        '>'
      );

      expect(results).toHaveLength(0);
    });
  });

  describe('getDocumentsByPropertyWithOperator - Datetime with time component', () => {
    let store: DocumentStore;

    beforeEach(async () => {
      store = createStore('getDocsByPropOpDatetime');
      await seedDocumentsWithProperties(store, [
        {
          doc: { path: 'notes/morning.md', fileName: 'morning', lastModified: 1000, tags: [] },
          properties: [{ name: 'updated', value: '2024-06-15T08:00:00' }],
        },
        {
          doc: { path: 'notes/noon.md', fileName: 'noon', lastModified: 2000, tags: [] },
          properties: [{ name: 'updated', value: '2024-06-15T12:30:00' }],
        },
        {
          doc: { path: 'notes/evening.md', fileName: 'evening', lastModified: 3000, tags: [] },
          properties: [{ name: 'updated', value: '2024-06-15T18:45:00' }],
        },
      ]);
    });

    it('should compare datetimes with ">" correctly within the same day', async () => {
      const results = await store.getDocumentsByPropertyWithOperator(
        'updated',
        '2024-06-15T12:30:00',
        '>'
      );

      expect(results).toHaveLength(1);
      expect(results[0].path).toBe('notes/evening.md');
    });

    it('should compare datetimes with "<" correctly within the same day', async () => {
      const results = await store.getDocumentsByPropertyWithOperator(
        'updated',
        '2024-06-15T12:30:00',
        '<'
      );

      expect(results).toHaveLength(1);
      expect(results[0].path).toBe('notes/morning.md');
    });

    it('should compare datetimes with ">=" to include the exact match', async () => {
      const results = await store.getDocumentsByPropertyWithOperator(
        'updated',
        '2024-06-15T12:30:00',
        '>='
      );

      expect(results).toHaveLength(2);
      const paths = results.map(d => d.path).sort();
      expect(paths).toEqual(['notes/evening.md', 'notes/noon.md']);
    });

    it('should compare datetimes with "<=" to include the exact match', async () => {
      const results = await store.getDocumentsByPropertyWithOperator(
        'updated',
        '2024-06-15T12:30:00',
        '<='
      );

      expect(results).toHaveLength(2);
      const paths = results.map(d => d.path).sort();
      expect(paths).toEqual(['notes/morning.md', 'notes/noon.md']);
    });

    it('should handle datetime with timezone suffix (Z)', async () => {
      // Query value uses Z timezone — should still be treated as valid ISO 8601
      const results = await store.getDocumentsByPropertyWithOperator(
        'updated',
        '2024-06-15T10:00:00Z',
        '>'
      );

      // "2024-06-15T10:00:00Z" > "2024-06-15T08:00:00" lexicographically
      // "2024-06-15T10:00:00Z" < "2024-06-15T12:30:00" lexicographically
      // "2024-06-15T10:00:00Z" < "2024-06-15T18:45:00" lexicographically
      expect(results).toHaveLength(2);
      const paths = results.map(d => d.path).sort();
      expect(paths).toEqual(['notes/evening.md', 'notes/noon.md']);
    });

    it('should handle datetime with offset timezone (+HH:MM)', async () => {
      const results = await store.getDocumentsByPropertyWithOperator(
        'updated',
        '2024-06-15T09:00:00+07:00',
        '<'
      );

      // "2024-06-15T08:00:00" < "2024-06-15T09:00:00+07:00" lexicographically
      expect(results).toHaveLength(1);
      expect(results[0].path).toBe('notes/morning.md');
    });
  });

  describe('getDocumentsByPropertyWithOperator - Non-comparable values', () => {
    let store: DocumentStore;

    beforeEach(async () => {
      store = createStore('getDocsByPropOpEdge');
      await seedDocumentsWithProperties(store, [
        {
          doc: { path: 'notes/a.md', fileName: 'a', lastModified: 1000, tags: [] },
          properties: [{ name: 'status', value: 'active' }],
        },
      ]);
    });

    it('should return empty for non-numeric, non-date string with ">" operator', async () => {
      const results = await store.getDocumentsByPropertyWithOperator('status', 'active', '>');

      expect(results).toHaveLength(0);
    });

    it('should return empty for non-numeric, non-date string with "<" operator', async () => {
      const results = await store.getDocumentsByPropertyWithOperator('status', 'active', '<');

      expect(results).toHaveLength(0);
    });

    it('should return empty for boolean value with range operator', async () => {
      const results = await store.getDocumentsByPropertyWithOperator('status', true, '>');

      expect(results).toHaveLength(0);
    });
  });
});
