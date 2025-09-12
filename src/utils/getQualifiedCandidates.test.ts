import { getQualifiedCandidates } from './getQualifiedCandidates';

describe('getQualifiedCandidates', () => {
  it('should return the candidates have scores gte 0.6', () => {
    const candidates = [
      { candidate: 1, score: 0.5 },
      { candidate: 2, score: 0.6 },
      { candidate: 3, score: 0.7 },
    ];

    const qualifiedCandidates = getQualifiedCandidates(candidates);

    expect(qualifiedCandidates).toEqual([
      { candidate: 3, score: 0.7 },
      { candidate: 2, score: 0.6 },
    ]);
  });

  it('should return candidates have highest scores with the minimum of 3', () => {
    const candidates = [
      { candidate: 1, score: 0.5 },
      { candidate: 2, score: 0.6 },
      { candidate: 3, score: 0.7 },
      { candidate: 4, score: 0.8 },
      { candidate: 5, score: 0.9 },
      { candidate: 6, score: 1.0 },
      { candidate: 7, score: 0.8 },
      { candidate: 8, score: 0.7 },
      { candidate: 9, score: 0.8 },
      { candidate: 10, score: 0.7 },
    ];

    const qualifiedCandidates = getQualifiedCandidates(candidates, {
      minCount: 3,
    });

    expect(qualifiedCandidates).toEqual([
      { candidate: 6, score: 1.0 },
      { candidate: 5, score: 0.9 },
      { candidate: 4, score: 0.8 },
      { candidate: 7, score: 0.8 },
      { candidate: 9, score: 0.8 },
    ]);
  });

  it('should return empty array when there are no qualified candidates', () => {
    const candidates = [
      { candidate: 1, score: 0.5 },
      { candidate: 2, score: 0.6 },
      { candidate: 3, score: 0.78 },
    ];

    const qualifiedCandidates = getQualifiedCandidates(candidates, {
      minThreshold: 0.8,
    });

    expect(qualifiedCandidates).toEqual([]);
  });
});
