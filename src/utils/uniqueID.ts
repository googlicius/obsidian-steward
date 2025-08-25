/**
 * Generate a unique 5-character string
 */
export function uniqueID() {
  const timestamp = Date.now().toString(36); // Convert timestamp to base-36 string
  const randomPart = Math.random().toString(36).substring(2, 7); // Get a random 5-character string

  // Combine timestamp and random part, then take the last 5 characters
  return (timestamp + randomPart).slice(-5);
}
