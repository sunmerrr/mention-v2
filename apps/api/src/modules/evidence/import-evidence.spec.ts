import { expect, it, vi } from 'vitest';
import { importEvidence } from './import-evidence.js';

const conversation = {
  id: 'synthetic',
  room: '합성',
  at: 1794538800000,
  title: '합성',
  targets: ['APL'],
  evaluations: { APL: { label: 'unreviewed', summary: '', origin: null, stale: false } },
  keywords: { APL: 1 },
  messageCount: 1,
};
const options = [
  {
    id: 'synthetic:APL',
    conversationId: 'synthetic',
    target: 'APL',
    label: 'unreviewed',
    summary: '',
    origin: null,
    stale: false,
    expected: 'token',
    room: '합성',
    at: 1794538800000,
    history: [],
  },
];
const overview = {
  overview: {
    capturedAt: '2026-11-13T07:00:00.000Z',
    source: 'synthetic',
    collectionState: 'synthetic',
    gaps: 0,
    targets: [{ name: 'APL', aliases: ['APL'], mentions: 1 }],
  },
};
const detail = {
  conversation,
  messages: [
    {
      id: '3970073012646000642',
      author: '합성',
      text: '합성 원문',
      time: 1794538800000,
      phase: 'discussion',
      background: false,
      own: false,
    },
  ],
  limited: true,
  before: 0,
  after: 0,
  source: 'synthetic',
};
it('imports read-only stable evidence when legacy detail omits its expected token', async () => {
  const calls: string[] = [];
  const source = {
    read: async (path: string) => {
      calls.push(path);
      if (path === '/api/overview') return overview;
      if (path === '/api/conversations')
        return {
          items: [conversation],
          nextCursor: null,
          total: 1,
          capturedAt: overview.overview.capturedAt,
        };
      if (path.endsWith('/classifications')) return options;
      return detail;
    },
  };
  const target = { importBundle: vi.fn(async () => ({})), publishMetadata: vi.fn(async () => {}) };
  expect(await importEvidence(source, target)).toMatchObject({ conversations: 1 });
  expect(calls.filter((p) => p.endsWith('/classifications'))).toHaveLength(2);
  expect(target.importBundle).toHaveBeenCalledOnce();
  expect(target.publishMetadata).toHaveBeenCalledOnce();
});
it('does not publish readiness or write an unstable source evaluation', async () => {
  let revision = 0;
  const source = {
    read: async (path: string) => {
      if (path === '/api/overview') return overview;
      if (path === '/api/conversations')
        return {
          items: [conversation],
          nextCursor: null,
          total: 1,
          capturedAt: overview.overview.capturedAt,
        };
      if (path.endsWith('/classifications'))
        return options.map((o) => ({ ...o, expected: `changing-${revision++}` }));
      return detail;
    },
  };
  const target = { importBundle: vi.fn(async () => ({})), publishMetadata: vi.fn(async () => {}) };
  await expect(importEvidence(source, target)).rejects.toThrow('UNSTABLE');
  expect(target.importBundle).not.toHaveBeenCalled();
  expect(target.publishMetadata).not.toHaveBeenCalled();
});
