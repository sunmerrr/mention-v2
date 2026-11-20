/** Unicode and alias boundaries shared by Node collection and validation. */
export const keywordIdentity = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s._-]+/gu, '');
const normalized = (value: string) =>
  value.normalize('NFKC').toLowerCase().replace(/ß/gu, 'ss').replace(/ς/gu, 'σ');
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const cache = new Map<string, RegExp>();
function expression(keyword: string, numeric: boolean) {
  const key = JSON.stringify([keyword, numeric]),
    existing = cache.get(key);
  if (existing) return existing;
  const compact = normalized(keyword).replace(/[\s._-]+/gu, '');
  let pattern = '(?!)';
  if (compact) {
    if (numeric && compact.includes('[숫자]'))
      pattern = compact
        .split('[숫자]')
        .map((part) => [...part].map(escaped).join('[\\s._-]*'))
        .join('[\\s._-]*[0-9]+[\\s._-]*');
    else if (/^[가-힣]$/u.test(compact))
      pattern = `(?<![가-힣a-z0-9])${escaped(compact)}(?:(?:님|씨)(?:이랑|하고|한테|에게|께서|은|는|이|가|을|를|도|의|랑)?|이랑|하고|한테|에게|께서|은|는|이|가|을|를|도|의|랑)?(?![가-힣a-z0-9])`;
    else {
      pattern = [...compact].map(escaped).join('[\\s._-]*');
      if (/^[a-z0-9]+$/u.test(compact)) pattern = `(?<![a-z0-9])${pattern}(?![a-z0-9])`;
    }
  }
  const compiled = new RegExp(pattern, 'u');
  cache.set(key, compiled);
  if (cache.size > 256) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return compiled;
}
export function keywordMatches(text: string, keywords: readonly string[], numeric = false) {
  const value = normalized(text);
  return keywords.filter((word) => expression(word, numeric).test(value));
}

export function keywordSpans(text: string, keywords: readonly string[]) {
  const value = normalized(text);
  return keywords.flatMap((keyword) =>
    [...value.matchAll(new RegExp(expression(keyword, false).source, 'gu'))].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    })),
  );
}
