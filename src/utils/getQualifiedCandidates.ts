export type CandidateWithScore<CANDIDATE_TYPE> = {
  candidate: CANDIDATE_TYPE;
  score: number;
};

/**
 * Get qualified candidates, the more candidates the higher the threshold.
 * Scores must meet the minimum threshold.
 */
export function getQualifiedCandidates<CANDIDATE_TYPE>(
  /** Candidates with their scores */
  candidates: CandidateWithScore<CANDIDATE_TYPE>[],
  options?: {
    /** Minimum score threshold (inclusive) */
    minThreshold?: number;
    /** The size of each bucket */
    bucketSize?: number;
    /** The minimum number of qualified IDs */
    minCount?: number;
  }
): CandidateWithScore<CANDIDATE_TYPE>[] {
  const { minThreshold = 0.6, bucketSize = 0.1, minCount = 5 } = options || {};

  if (minThreshold < 0) {
    throw new Error('Invalid threshold values');
  }
  if (bucketSize <= 0) {
    throw new Error('Bucket size must be positive');
  }
  if (minCount < 0) {
    throw new Error('Count values must be non-negative');
  }

  // Group candidates by score buckets
  const buckets = new Map<number, CandidateWithScore<CANDIDATE_TYPE>[]>();

  for (const item of candidates) {
    if (item.score < minThreshold) {
      continue;
    }

    // Calculate bucket index
    const bucketIndex = Math.floor(item.score / bucketSize);

    if (!buckets.has(bucketIndex)) {
      buckets.set(bucketIndex, []);
    }
    buckets.get(bucketIndex)?.push(item);
  }

  // Sort buckets by score (highest first)
  const sortedBucketIndices = Array.from(buckets.keys()).sort((a, b) => b - a);
  const qualifiedCandidates: CandidateWithScore<CANDIDATE_TYPE>[] = [];

  // Select candidates starting from highest-scoring buckets
  for (const bucketIndex of sortedBucketIndices) {
    const bucketCandidates = buckets.get(bucketIndex) as CandidateWithScore<CANDIDATE_TYPE>[];
    qualifiedCandidates.push(...bucketCandidates);

    // Stop if we have at least the minimum required count
    if (qualifiedCandidates.length >= minCount) {
      break;
    }
  }

  return qualifiedCandidates;
}
