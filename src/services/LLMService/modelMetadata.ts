import { MODELS_METADATA, type BundledModelMetadata } from 'src/generated/modelsMetadata';

export type { BundledModelMetadata };

const DATE_SUFFIX_PATTERN = /-(?:\d{8}|\d{4}-\d{2}-\d{2})$/;

function parseFullModelId(fullModelId: string): { provider: string; modelId: string } {
  const colonIndex = fullModelId.indexOf(':');
  if (colonIndex === -1) {
    return { provider: '', modelId: fullModelId };
  }

  return {
    provider: fullModelId.substring(0, colonIndex),
    modelId: fullModelId.substring(colonIndex + 1),
  };
}

export function normalizeModelId(modelId: string): string {
  let normalized = modelId.trim();
  if (!normalized) {
    return normalized;
  }

  const tagIndex = normalized.indexOf(':');
  if (tagIndex !== -1) {
    normalized = normalized.substring(0, tagIndex);
  }

  normalized = normalized.replace(DATE_SUFFIX_PATTERN, '');
  return normalized;
}

function findContainedKnownModel(...modelIds: string[]): BundledModelMetadata | undefined {
  let bestMatch: BundledModelMetadata | undefined;
  let bestLength = 0;
  const seenHaystacks = new Set<string>();

  for (let m = 0; m < modelIds.length; m++) {
    const haystack = modelIds[m].trim().toLowerCase();
    if (!haystack || seenHaystacks.has(haystack)) {
      continue;
    }
    seenHaystacks.add(haystack);

    const providers = Object.keys(MODELS_METADATA);
    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      const providerModels = MODELS_METADATA[provider];
      const knownIds = Object.keys(providerModels);
      for (let j = 0; j < knownIds.length; j++) {
        const knownId = knownIds[j];
        if (!haystack.includes(knownId.toLowerCase())) {
          continue;
        }

        if (knownId.length > bestLength) {
          bestLength = knownId.length;
          bestMatch = providerModels[knownId];
        }
      }
    }
  }

  return bestMatch;
}

function findLongestPrefixMatch(
  providerModels: Record<string, BundledModelMetadata>,
  modelId: string
): BundledModelMetadata | undefined {
  let bestMatch: BundledModelMetadata | undefined;
  let bestLength = 0;

  const knownIds = Object.keys(providerModels);
  for (let i = 0; i < knownIds.length; i++) {
    const knownId = knownIds[i];
    if (!modelId.startsWith(knownId) && !knownId.startsWith(modelId)) {
      continue;
    }

    if (knownId.length > bestLength) {
      bestLength = knownId.length;
      bestMatch = providerModels[knownId];
    }
  }

  return bestMatch;
}

/**
 * Resolve bundled models.dev metadata for `provider:modelId`.
 * Resolution order: exact → normalized id → longest-prefix → known-id substring (includes).
 */
export function getModelMetadata(fullModelId: string): BundledModelMetadata | undefined {
  const trimmed = fullModelId?.trim() ?? '';
  if (!trimmed) {
    return undefined;
  }

  const { provider, modelId } = parseFullModelId(trimmed);
  if (!modelId) {
    return undefined;
  }

  const normalizedId = normalizeModelId(modelId);

  const providerModels = provider ? MODELS_METADATA[provider] : undefined;
  if (providerModels) {
    const exact = providerModels[modelId];
    if (exact) {
      return exact;
    }

    if (normalizedId !== modelId) {
      const normalizedExact = providerModels[normalizedId];
      if (normalizedExact) {
        return normalizedExact;
      }
    }

    const prefixMatch = findLongestPrefixMatch(providerModels, normalizedId);
    if (prefixMatch) {
      return prefixMatch;
    }
  }

  return findContainedKnownModel(modelId, normalizedId);
}

/**
 * Format token counts for settings UI (e.g. 128000 → "128K", 1000000 → "1M").
 */
export function formatContextLengthTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return String(tokens);
  }

  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return Number.isInteger(millions) ? `${millions}M` : `${millions.toFixed(1)}M`;
  }

  if (tokens >= 1_000) {
    const thousands = tokens / 1_000;
    return Number.isInteger(thousands) ? `${thousands}K` : `${thousands.toFixed(1)}K`;
  }

  return String(Math.floor(tokens));
}
