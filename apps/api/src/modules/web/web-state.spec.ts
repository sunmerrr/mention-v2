import { expect, it } from 'vitest';
import { serializeBootstrap } from './web-state.js';

it('keeps Korean/HTML-like evidence identical while preventing script termination', () => {
  const state = { message: '룰루 <코드> & </script><script>bad()</script> 😊', note: '\u0000' };
  const output = serializeBootstrap(state);
  expect(output).not.toContain('<');
  expect(output).not.toContain('&');
  expect(JSON.parse(output)).toEqual(state);
});
