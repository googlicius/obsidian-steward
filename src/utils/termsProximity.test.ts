import { termsProximity } from './termsProximity';

describe('termsProximity', () => {
  it('should return true whe there is only one query term', () => {
    const termPositions = new Map<string, number[]>([
      ['term1', [1, 2, 3]],
      ['term2', [7, 9]],
    ]);

    expect(termsProximity(termPositions, ['term1'])).toMatchObject({
      isProximity: true,
      minDistances: [],
    });
    expect(termsProximity(termPositions, ['term2'])).toMatchObject({
      isProximity: true,
      minDistances: [],
    });
  });

  it('should return true when the terms can be traversed', () => {
    const termPositions = new Map<string, number[]>([
      ['term1', [1, 2, 3]],
      ['term2', [7, 9]],
    ]);

    expect(termsProximity(termPositions, ['term1', 'term2'])).toMatchObject({
      isProximity: true,
      minDistances: [4],
    });
    expect(termsProximity(termPositions, ['term2', 'term1'])).toMatchObject({
      isProximity: true,
      minDistances: [4],
    });
  });

  it('should return false when the terms cannot be traversed', () => {
    const termPositions = new Map<string, number[]>([
      ['term1', [1, 2, 3]],
      ['term2', [7, 9]],
    ]);

    expect(termsProximity(termPositions, ['term1', 'term2'], 3)).toMatchObject({
      isProximity: false,
      minDistances: [],
    });
    expect(termsProximity(termPositions, ['term2', 'term1'], 3)).toMatchObject({
      isProximity: false,
      minDistances: [],
    });
  });

  it('should return true when we can connect between terms', () => {
    const termPositions = new Map<string, number[]>([
      ['term1', [1, 6]],
      ['term2', [7, 9]],
      ['term3', [11]],
    ]);

    expect(termsProximity(termPositions, ['term3', 'term1', 'term2'], 2)).toMatchObject({
      isProximity: true,
      minDistances: [2, 1],
    });
    expect(termsProximity(termPositions, ['term2', 'term3', 'term1'], 2)).toMatchObject({
      isProximity: true,
      minDistances: [2, 1],
    });
  });

  it('should return false when term4 is too far', () => {
    const termPositions = new Map<string, number[]>([
      ['term1', [1, 6]],
      ['term2', [7, 9]],
      ['term3', [11]],
      ['term4', [20, 15, 17]],
    ]);

    expect(termsProximity(termPositions, ['term3', 'term1', 'term2', 'term4'], 2)).toMatchObject({
      isProximity: false,
      minDistances: [2, 1],
    });
    expect(termsProximity(termPositions, ['term2', 'term3', 'term1', 'term4'], 2)).toMatchObject({
      isProximity: false,
      minDistances: [2, 1],
    });
    expect(termsProximity(termPositions, ['term4', 'term1', 'term3', 'term2'], 2)).toMatchObject({
      isProximity: false,
      minDistances: [],
    });
  });
});
