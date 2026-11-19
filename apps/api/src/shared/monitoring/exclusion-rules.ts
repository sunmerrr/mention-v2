import { createHash } from 'node:crypto';
import { keywordMatches } from '@app/shared/monitoring/domain/keyword-rules';

const automaticRule = /^\[자동 (?:광고|제외)\] [^\n]+ #([a-f0-9]{64})(?![\s\S])/u;
// biome-ignore lint/suspicious/noControlCharactersInRegex: Match the whitespace used by Python str.split in stored fingerprints.
const fingerprintWhitespace = /[\p{White_Space}\u001c-\u001f]+/u;

export function matchingExclusions(text: string, rules: readonly string[]) {
  let fingerprint: string | undefined;
  const configured = rules.map((rule) => ({ rule, exact: automaticRule.exec(rule) }));
  const literal = new Set(
    keywordMatches(
      text,
      configured.filter(({ exact }) => !exact).map(({ rule }) => rule),
      true,
    ),
  );
  return configured
    .filter(({ rule, exact }) => {
      if (!exact) return literal.has(rule);
      fingerprint ??= createHash('sha256')
        .update(text.normalize('NFKC').split(fingerprintWhitespace).filter(Boolean).join(' '))
        .digest('hex');
      return fingerprint === exact[1];
    })
    .map(({ rule }) => rule);
}
