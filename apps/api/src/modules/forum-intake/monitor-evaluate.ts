import {
  accessEvidence,
  commentSummary,
  controlAckRecord,
  controlEnqueueRecord,
  controlPollRecord,
  controlResultRecord,
  monitorEventTransition,
  monitorRecord,
  monitorTransition,
  monitorUrl,
  trialRecord,
  trialTransition,
} from '@app/shared';
export type Case = {
  name: string;
  kind: string;
  value: unknown;
  previous?: unknown;
  extensionId?: unknown;
};
export function apply(c: Case): unknown {
  switch (c.kind) {
    case 'monitor':
      return monitorRecord(c.value);
    case 'trial':
      return trialRecord(c.value);
    case 'url':
      return monitorUrl(c.value);
    case 'access':
      return accessEvidence(c.value);
    case 'summary':
      return commentSummary(c.value);
    case 'monitor-transition':
      monitorTransition(c.previous ? monitorRecord(c.previous) : null, monitorRecord(c.value));
      return null;
    case 'trial-transition':
      trialTransition(c.previous ? trialRecord(c.previous) : null, trialRecord(c.value));
      return null;
    case 'event-transition':
      monitorEventTransition(
        c.previous as Parameters<typeof monitorEventTransition>[0],
        c.value as Parameters<typeof monitorEventTransition>[1],
      );
      return null;
    case 'enqueue':
      return controlEnqueueRecord(c.value);
    case 'poll':
      return controlPollRecord(c.value, c.extensionId);
    case 'result':
      return controlResultRecord(c.value);
    case 'ack':
      return controlAckRecord(c.value, c.extensionId);
    default:
      throw Error('Unknown case');
  }
}
