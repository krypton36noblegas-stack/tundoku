import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRequestedCount } from './scanConfig.js';

test('normalizeRequestedCount clamps values into a sensible range', () => {
  assert.equal(normalizeRequestedCount('8'), 8);
  assert.equal(normalizeRequestedCount('20'), 20);
  assert.equal(normalizeRequestedCount('999'), 20);
  assert.equal(normalizeRequestedCount('0'), 8);
  assert.equal(normalizeRequestedCount('abc'), 8);
});
