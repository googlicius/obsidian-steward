/**
 * Joins an array with a conjunction word before the last item
 * @example joinWithConjunction(['apple', 'banana', 'orange'], 'and') => 'apple, banana, and orange'
 * @example joinWithConjunction(['apple', 'orange'], 'or') => 'apple or orange'
 */
export function joinWithConjunction(
  array: string[],
  conjunction: 'and' | 'or',
  separator = ', '
): string {
  if (!array || array.length === 0) {
    return '';
  }

  if (array.length === 1) {
    return array[0];
  }

  if (array.length === 2) {
    return `${array[0]} ${conjunction} ${array[1]}`;
  }

  return `${array.slice(0, -1).join(separator)}${separator}${conjunction} ${array[array.length - 1]}`;
}

export function removeConsecutiveItems(array: string[]): string[] {
  return array.reduce<string[]>((acc, item) => {
    if (acc.length === 0) {
      acc.push(item);
    } else {
      const lastItem = acc[acc.length - 1];
      if (lastItem !== item) {
        acc.push(item);
      }
    }
    return acc;
  }, []);
}

/**
 * Create a simple hash from an array of strings
 */
export function hashTerms(terms: string[]): string {
  let hash = 5381; // Initial hash value (prime number)
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    for (let j = 0; j < term.length; j++) {
      const char = term.charCodeAt(j);
      hash = (hash << 5) - hash + char;
      hash = hash >>> 0; // Convert to unsigned 32bit integer
    }
  }
  return hash.toString(36);
}
