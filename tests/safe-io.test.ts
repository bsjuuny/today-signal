import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { kisInt, kisNumber, kisRows, writeJsonAtomic, isRecentTradingDate } from '../lib/safe-io';

test('kisNumber keeps blanks as 0 but rejects non-numeric text instead of NaN', () => {
  assert.equal(kisNumber('', 'f'), 0);
  assert.equal(kisNumber(undefined, 'f'), 0);
  assert.equal(kisNumber('-12.5', 'f'), -12.5);
  assert.equal(kisInt('00001234', 'f'), 1234);
  assert.equal(kisInt('1,234', 'f'), 1234);
  // parseInt('N/A') was NaN and NaN < 500 is false, so filters were bypassed.
  assert.throws(() => kisInt('N/A', 'hts_avls'), /hts_avls/);
  assert.throws(() => kisNumber('12abc', 'prdy_ctrt'), /prdy_ctrt/);
  assert.throws(() => kisNumber('1,,2,3', 'f'));
  assert.throws(() => kisNumber('12,34', 'f'));
  assert.throws(() => kisInt('12.9', 'acml_vol'), /acml_vol/);
  assert.equal(kisInt('12.00', 'f'), 12);
});

test('kisRows accepts an empty list but rejects a missing or malformed list', () => {
  assert.deepEqual(kisRows({ rt_cd: '0', output: [] }, 'output', 'T'), []);
  assert.throws(() => kisRows({ rt_cd: '0' }, 'output', 'T'), /output/);
  assert.throws(() => kisRows({ rt_cd: '0', output: null }, 'output', 'T'));
  assert.throws(() => kisRows({ rt_cd: '0', output2: {} }, 'output2', 'T'));
});

test('writeJsonAtomic replaces the file and leaves no temp file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-atomic-'));
  const file = path.join(dir, 'sub', 'out.json');
  writeJsonAtomic(file, { a: 1 });
  writeJsonAtomic(file, { a: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf-8')), { a: 2 });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['out.json']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('isRecentTradingDate counts weekdays and rejects stale, future and malformed dates', () => {
  assert.equal(isRecentTradingDate('20261125', '20261126'), true);   // 1 weekday
  assert.equal(isRecentTradingDate('20261120', '20261125'), true);   // Fri -> Wed = 3 weekdays
  assert.equal(isRecentTradingDate('20261119', '20261125'), false);  // 4 weekdays
  assert.equal(isRecentTradingDate('20261127', '20261126'), false);  // future
  assert.equal(isRecentTradingDate(undefined, '20261126'), false);
  assert.equal(isRecentTradingDate('2026-11-25', '20261126'), false);
  assert.equal(isRecentTradingDate('20260231', '20260304'), false); // nonexistent date
});
