import { expect, it } from 'vitest';
import { config } from '../../shared/config/index.js';
import { isLocalRequest } from './mutation-scope.js';

it('keeps tunneled requests public even when they arrive from the configured loopback gateway', () => {
  const saved = config.MENTION_LOOPBACK_GATEWAY_IP;
  config.MENTION_LOOPBACK_GATEWAY_IP = '172.18.0.1';
  try {
    expect(isLocalRequest({ ip: '172.18.0.1', headers: {} })).toBe(true);
    expect(isLocalRequest({ ip: '172.18.0.2', headers: {} })).toBe(false);
    for (const key of ['cf-ray', 'cf-connecting-ip', 'x-forwarded-for', 'x-monitor-public']) {
      expect(isLocalRequest({ ip: '172.18.0.1', headers: { [key]: 'present' } })).toBe(false);
    }
  } finally {
    config.MENTION_LOOPBACK_GATEWAY_IP = saved;
  }
});
