import { Scoring } from './scoring';
import { DocumentStore } from './documentStore';

describe('scoring', () => {
  describe('calculateProximityScore', () => {
    let scoring: Scoring;
    let mockDocumentStore: DocumentStore;

    beforeEach(() => {
      mockDocumentStore = {} as DocumentStore;
      scoring = new Scoring(mockDocumentStore, {
        proximityThreshold: 10,
      });
    });

    it('should return high score when 2 terms are next to each other', () => {
      const termPositions = new Map<string, number[]>([
        ['hello', [5]],
        ['world', [6]],
      ]);

      // Act
      const result1 = scoring.calculateProximityScore(termPositions, ['hello', 'world']);
      const result2 = scoring.calculateProximityScore(termPositions, ['world', 'hello']);

      expect(result1).toEqual(0.9);
      expect(result2).toEqual(0.9);
    });

    it('should return high score when 1 term match', () => {
      const termPositions = new Map<string, number[]>([['hello', [5]]]);

      const result = scoring.calculateProximityScore(termPositions, ['hello']);

      expect(result).toEqual(0.9);
    });

    it('should return lower score when 2 terms are not next to each other', () => {
      const termPositions = new Map<string, number[]>([
        ['hello', [5]],
        ['world', [7]],
        ['friend', [10]],
      ]);

      // Test with terms that exist in the map
      const result1 = scoring.calculateProximityScore(termPositions, ['hello', 'world']);
      const result2 = scoring.calculateProximityScore(termPositions, ['hello', 'friend']);

      expect(result1).toEqual(0.8);
      expect(result2).toEqual(0.5);
    });

    it('should return a score higher than 0', () => {
      const termPositions = new Map<string, number[]>([
        ['hello', [5]],
        ['world', [7]],
        ['friendly', [11]],
        ['cats', [20]],
      ]);

      expect(
        scoring.calculateProximityScore(termPositions, ['hello', 'friendly', 'cats'])
      ).toBeGreaterThan(0);

      expect(
        scoring.calculateProximityScore(termPositions, ['cats', 'hello', 'friendly'])
      ).toBeGreaterThan(0);

      expect(
        scoring.calculateProximityScore(termPositions, ['friendly', 'cats', 'hello'])
      ).toBeGreaterThan(0);
    });

    it('should return 0 when the threshold is exceeded', () => {
      const termPositions = new Map<string, number[]>([
        ['hello', [5]],
        ['world', [7]],
        ['cats', [20]],
      ]);

      const result = scoring.calculateProximityScore(termPositions, ['hello', 'cats']);

      // hello-cats: distance 15, exceeds threshold, score = 0
      expect(result).toEqual(0);
    });

    it('should return 0 when the terms distance is greater than the threshold', () => {
      const termPositions = new Map<string, number[]>([
        ['What', [5]],
        ['your', [6]],
        ['cats', [20]],
      ]);

      const result = scoring.calculateProximityScore(termPositions, ['What', 'your', 'cats']);

      // hello-cats: distance 15, exceeds threshold, score = 0
      expect(result).toEqual(0);
    });
  });
});
