/** Source object key order is not a message revision. Array order remains evidence. */
export function stableJson(value: unknown): string {
  function order(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(order);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, val]) => [key, order(val)]),
      );
    return item;
  }
  return JSON.stringify(order(value));
}
