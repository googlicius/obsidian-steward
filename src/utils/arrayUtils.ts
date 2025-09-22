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
