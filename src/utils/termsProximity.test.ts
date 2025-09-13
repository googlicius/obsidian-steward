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

  it('should return true even a term is not in the termPositions', () => {
    const termPositions = new Map<string, number[]>([
      ['term1', [1, 2, 3]],
      ['term2', [7, 9]],
    ]);

    expect(termsProximity(termPositions, ['term1', 'term2', 'term3'])).toMatchObject({
      isProximity: true,
      minDistances: [4],
    });
  });

  it('should return false when all terms are filtered out', () => {
    const termPositions = new Map<string, number[]>([
      ['term1', [1, 2, 3]],
      ['term2', [7, 9]],
    ]);

    expect(termsProximity(termPositions, ['term3', 'term4'])).toMatchObject({
      isProximity: false,
      minDistances: [],
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

  it('should return true with *git tag* query', () => {
    const termPositions = new Map([
      ['git', [91, 92, 97, 107, 136, 139, 147]],
      ['tag', [93, 129, 96, 98, 116, 135, 137, 140, 145, 148]],
    ]);

    expect(termsProximity(termPositions, ['git', 'tag'])).toMatchObject({
      isProximity: true,
      minDistances: [1],
    });
  });
});
