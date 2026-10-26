import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import MarketBanner from '../app/components/MarketBanner';
import { parseMarketNumber, parseIndexQuote, buildMarketContext, isMarketUsable } from '../lib/market-data';
import { isMarketSuppressed, marketMultiplier, scoreInstBuy, scoreForeignBuy, scoreVolumeSurge, scoreStrongDemand, scoreMomentum } from '../lib/scoring';
import type { MarketContext, StockItem, SupplyDemand } from '../types/stock';
import official from './fixtures/kis-official-index.json';
const close = new Date('2026-10-16T07:10:00Z');
function market(response: Record<string, unknown> = official, time = close) {
  const q = parseIndexQuote(response, '0001');
  return buildMarketContext(q, q, false, time);
}

test('strict parsing preserves explicit zero, rejects missing and partial values', () => {
  for (const x of [undefined, null, '', ' ', '12abc', 'NaN', 'Infinity', {}, '1,000']) assert.equal(parseMarketNumber(x), null);
  assert.equal(parseMarketNumber('0'), 0);
  assert.equal(parseMarketNumber('-0.19'), -0.19);
});

test('official response: unit never inferred; confirmed contracts convert exactly once', () => {
  delete process.env.KIS_INDEX_TRADING_VALUE_UNIT;
  assert.equal(market().kospiVolume, null);
  assert.equal(isMarketUsable(market()), false);
  process.env.KIS_INDEX_TRADING_VALUE_UNIT = 'MILLION_KRW';
  assert.equal(market().kospiVolume, 115079.62);
  assert.equal(isMarketUsable(market()), true);
  process.env.KIS_INDEX_TRADING_VALUE_UNIT = 'KRW';
  assert.equal(market().kospiVolume, 0.11507962);
  delete process.env.KIS_INDEX_TRADING_VALUE_UNIT;
});

test('missing, malformed, business error, array output and inconsistent rates fail closed', () => {
  for (const patch of [{acml_tr_pbmn: ''}, {bstp_nmix_prdy_ctrt: 'bad'}, {bstp_nmix_prdy_ctrt: '0'}, {prdy_vrss_sign: '2'}, {bstp_nmix_prdy_ctrt: '-4.00'}]) {
    const m = market({...official, output: {...official.output, ...patch}});
    assert.equal(isMarketUsable(m), false);
    assert.ok(m.quality!.issues.length);
  }
  for (const response of [{rt_cd: '1', output: official.output}, {rt_cd: '0', output: []}, {}]) {
    assert.equal(parseIndexQuote(response, '0001').changePct, null);
  }
});

test('genuine flat index accepted with activity, reset/no-activity and pre-open rejected', () => {
  process.env.KIS_INDEX_TRADING_VALUE_UNIT = 'MILLION_KRW';
  const flat = {...official, output: {...official.output, bstp_nmix_prdy_vrss: '0', bstp_nmix_prdy_ctrt: '0', prdy_vrss_sign: '3'}};
  assert.equal(isMarketUsable(market(flat)), true);
  // 2026-10-26 09:35: +0.04pt on 5550.34 is reported with a rounded 0.00% rate.
  const tiny = {...official, output: {...official.output, bstp_nmix_prpr: '5550.34', bstp_nmix_prdy_vrss: '0.04', bstp_nmix_prdy_ctrt: '0.00', prdy_vrss_sign: '2'}};
  assert.deepEqual(market(tiny).quality!.issues, []);
  assert.equal(market(tiny).kospiChange, 0);
  for (const patch of [{prdy_vrss_sign: '3'}, {prdy_vrss_sign: '5'}, {bstp_nmix_prdy_vrss: '5.00'}]) {
    assert.equal(isMarketUsable(market({...tiny, output: {...tiny.output, ...patch}})), false);
  }
  const zero = market({...flat, output: {...flat.output, acml_vol: '0', acml_tr_pbmn: '0'}});
  assert.equal(zero.kospiVolume, 0); // explicit zero retained, but not usable
  assert.equal(isMarketUsable(zero), false);
  const pre = market(flat, new Date('2026-10-14T23:25:09Z'));
  assert.equal(pre.kospiChange, null);
  assert.equal(isMarketUsable(pre), false);
  delete process.env.KIS_INDEX_TRADING_VALUE_UNIT;
});

test('all scoring entry points reject unavailable and unversioned legacy contexts', () => {
  const legacy: MarketContext = {kospiChange: 0, kosdaqChange: 0, kospiVolume: 0, fetchedAt: close.toISOString(), isIntraday: false};
  const stock = {} as StockItem;
  const supply = {} as SupplyDemand;
  for (const m of [legacy, market(), {...legacy, kospiChange: NaN}]) {
    assert.equal(isMarketSuppressed(m), true);
    assert.equal(marketMultiplier(m), 0);
    for (const score of [scoreInstBuy, scoreForeignBuy, scoreVolumeSurge, scoreStrongDemand]) assert.equal(score(stock, supply, m), null);
    assert.equal(scoreMomentum(stock, m), null);
  }
});

test('banner renders missing/legacy values without 0억 or fabricated flat rates', () => {
  const m: MarketContext = {kospiChange: 0, kosdaqChange: 0, kospiVolume: 0, isIntraday: false, fetchedAt: close.toISOString()};
  const html = renderToStaticMarkup(MarketBanner({market: m, date: '20261016'}));
  assert.match(html, /확인 불가/);
  assert.doesNotMatch(html, /0억|0\.00%/);
});

test('October 14–16 archives remain unchanged, quarantined for scoring and display', () => {
  for (const date of ['20261014', '20261015', '20261016']) {
    const file = path.join('public/data/history', `signal_${date}.json`);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(data.market.kospiVolume, 0);
    assert.equal(isMarketUsable(data.market), false);
    assert.equal(scoreMomentum({} as StockItem, data.market), null);
    assert.doesNotMatch(renderToStaticMarkup(MarketBanner({market: data.market, date})), /0억|0\.00%/);
  }
});

test('unavailable persistence clears existing trader signals atomically and leaves archives intact', async () => {
  const { saveUnavailableMarket } = await import('../lib/signal-storage');
  const { tmpdir } = await import('node:os');
  const root = fs.mkdtempSync(path.join(tmpdir(), 'signal-market-test-'));
  try {
    const website = path.join(root, 'website/today_signal.json');
    const trader = path.join(root, 'trader/today_signal.json');
    fs.mkdirSync(path.dirname(trader), {recursive: true});
    fs.writeFileSync(trader, '{"signals":{"momentum":[{"score":99}]}}');
    const archive = path.join(root, 'history.json');
    fs.writeFileSync(archive, 'original');
    saveUnavailableMarket(market(), '20261016', website, trader);
    assert.equal(fs.readFileSync(website, 'utf8'), fs.readFileSync(trader, 'utf8'));
    const data = JSON.parse(fs.readFileSync(trader, 'utf8'));
    assert.equal(data.status, 'failed');
    assert.equal(Object.values(data.signals).flat().length, 0);
    assert.equal(fs.readFileSync(archive, 'utf8'), 'original');
    assert.equal(fs.readdirSync(path.dirname(trader)).length, 1);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('validated flat market is neither suppressed nor discounted; bearish thresholds still work', () => {
  const valid: MarketContext = {kospiChange: 0, kosdaqChange: 0, kospiVolume: 115079.62,
    isIntraday: false, fetchedAt: close.toISOString(),
    quality: {status: 'valid', source: 'test', issues: [], tradingValueUnit: 'MILLION_KRW'}};
  assert.equal(isMarketSuppressed(valid), false);
  assert.equal(marketMultiplier(valid), 1);
  assert.equal(marketMultiplier({...valid, kospiChange: -1.1}), 0.8);
  assert.equal(isMarketSuppressed({...valid, kosdaqChange: -2.1}), true);
});
