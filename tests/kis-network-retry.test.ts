import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withNetworkRetry } from '../lib/kis-api';

// 2026-10-28 12:08: a single "fetch failed" on 034020 blocked the whole signal run.
const networkError = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });

test('transient network failure is retried and succeeds', async () => {
  let calls = 0;
  const result = await withNetworkRetry(async () => {
    calls++;
    if (calls < 3) throw networkError();
    return 'ok';
  }, [0, 0]);
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('persistent network failure still fails after the retry budget', async () => {
  let calls = 0;
  await assert.rejects(withNetworkRetry(async () => { calls++; throw networkError(); }, [0, 0]), /fetch failed/);
  assert.equal(calls, 3);
});

test('API errors are not retried as network errors', async () => {
  let calls = 0;
  await assert.rejects(withNetworkRetry(async () => { calls++; throw new Error('KIS API 오류 500'); }, [0, 0]), /KIS API/);
  assert.equal(calls, 1);
});
