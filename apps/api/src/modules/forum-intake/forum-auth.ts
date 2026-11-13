import { createHash } from 'node:crypto';
export interface CollectorPrincipal {
  pk: number;
  id: string;
  extensionId: string;
}
export function collectorTokenHash(token: string) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error('INVALID_COLLECTOR_TOKEN');
  return createHash('sha256').update(token).digest('hex');
}
export function collectorCredentials(headers: Record<string, string | string[] | undefined>) {
  const token = headers.authorization;
  const extension = headers['x-mention-extension'];
  if (
    typeof token !== 'string' ||
    !token.startsWith('Bearer ') ||
    typeof extension !== 'string' ||
    !/^[a-p]{32}$/.test(extension)
  )
    throw new Error('COLLECTOR_FORBIDDEN');
  const origin = headers.origin;
  if (origin !== undefined && origin !== `chrome-extension://${extension}`)
    throw new Error('COLLECTOR_FORBIDDEN');
  return { hash: collectorTokenHash(token.slice(7)), extension };
}
