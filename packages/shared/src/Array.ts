export function copySorted<T>(
  values: ReadonlyArray<T>,
  compareFn?: (left: T, right: T) => number,
): T[] {
  return [...values].sort(compareFn);
}

export function sortByPreferredOrder<T>(
  values: ReadonlyArray<T>,
  order: ReadonlyArray<string>,
  key: (value: T) => string,
): T[] {
  const ranks = new Map(order.map((value, index) => [value, index]));
  return copySorted(
    values,
    (left, right) => (ranks.get(key(left)) ?? Infinity) - (ranks.get(key(right)) ?? Infinity),
  );
}
