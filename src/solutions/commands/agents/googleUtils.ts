export function isGoogleModel(modelId: string | undefined | null): boolean {
  if (modelId === undefined || modelId === null || modelId === '') {
    return false;
  }
  return /gemini|gemma/i.test(modelId);
}
