import { createElement } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import SignalView from '../app/components/SignalView';
import SignalCard from '../app/components/SignalCard';
import { parseInstrumentInfo, filterStockSignals, classifiedSignals } from '../lib/instrument';
import { scoreInstBuy, scoreForeignBuy, scoreVolumeSurge, scoreStrongDemand, scoreMomentum } from '../lib/scoring';
import type { StockItem, TodaySignalData } from '../types/stock';

const archive = (date: string): TodaySignalData => JSON.parse(fs.readFileSync(`public/data/history/signal_${date}.json`, 'utf8'));
// Contract fixtures for official CTPF1002R fields, not captured live API responses.
const info = (code: string, group = 'ST', market = 'KOSPI', date = '20261026') => parseInstrumentInfo(code, {
  rt_cd: '0', output: { pdno: code, prdt_type_cd: '300', scty_grp_id_cd: group,
    scts_mket_lstg_dt: market === 'KOSPI' ? '20100101' : '00000000', scts_mket_lstg_abol_dt: '00000000',
    kosdaq_mket_lstg_dt: market === 'KOSDAQ' ? '20160920' : '00000000', kosdaq_mket_lstg_abol_dt: '00000000' },
}, date);

test('Oct 26 Uni Techno retains volume signal with corrected KOSDAQ classification', () => {
  const data = archive('20261026');
  const original = data.signals.volumeSurge.find(s => s.stock.code === '241690')!;
  assert.equal(original.stock.market, 'KOSPI');
  const stock = { ...original.stock, ...info('241690', 'ST', 'KOSDAQ') };
  const signal = scoreVolumeSurge(stock, original.supply, data.market);
  assert.ok(signal);
  assert.equal(signal.stock.market, 'KOSDAQ');
  assert.equal(signal.score, original.score);
  assert.equal(filterStockSignals([signal], data.date, 'KOSPI').length, 0);
  assert.equal(filterStockSignals([signal], data.date, 'KOSDAQ').length, 1);
  const html = renderToStaticMarkup(createElement(SignalCard, {signal, rank: 1}));
  assert.match(html, /KOSDAQ/);
  assert.match(html, /기업 주식/);
});

test('Oct 26 inverse 2X ETN and Oct 23 four ETFs never enter any stock scorer', () => {
  const d26 = archive('20261026');
  const d23 = archive('20261023');
  const cases = [
    {data: d26, signal: d26.signals.instBuy.find(s => s.stock.code === 'Q530107')!, type: 'EN'},
    ...['KODEX 200', 'TIGER 200', 'SOL AI반도체TOP2플러스', 'TIGER 반도체TOP10'].map(name =>
      ({data: d23, signal: d23.signals.instBuy.find(s => s.stock.name === name)!, type: 'EF'})),
  ];
  assert.equal(d23.signals.instBuy.length, 9);
  for (const {data, signal, type} of cases) {
    assert.ok(signal);
    const stock = {...signal.stock, ...info(signal.stock.code, type, 'KOSPI', data.date)};
    assert.equal(stock.instrumentType, type === 'EN' ? 'ETN' : 'ETF');
    for (const score of [scoreInstBuy, scoreForeignBuy, scoreVolumeSurge, scoreStrongDemand])
      assert.equal(score(stock, signal.supply, data.market), null);
    assert.equal(scoreMomentum(stock, data.market), null);
    assert.equal(filterStockSignals([{...signal, stock}], data.date).length, 0);
  }
});

test('unknown metadata fails closed; numeric or Q ticker and ETF names cannot establish type', () => {
  for (const code of ['005930', '241690', 'Q530107']) {
    for (const response of [{}, {rt_cd:'1'}, {rt_cd:'0', output:[]}, {rt_cd:'0', output:{pdno:'wrong', prdt_type_cd:'300', scty_grp_id_cd:'ST'}}]) {
      assert.deepEqual(parseInstrumentInfo(code, response, '20261026'), {market:'UNKNOWN', instrumentType:'UNKNOWN'});
    }
    assert.equal(info(code, '??').instrumentType, 'UNKNOWN');
    assert.equal(info(code, 'EN').instrumentType, 'ETN');
    assert.equal(info(code, 'ST').instrumentType, 'STOCK');
  }
  const stock = {...archive('20261026').signals.volumeSurge[0].stock, instrumentType: 'STOCK'} as StockItem;
  assert.equal(filterStockSignals([{...archive('20261026').signals.volumeSurge[0], stock}]).length, 0);
});

test('ambiguous, missing, future or delisted market never defaults to KOSPI', () => {
  for (const patch of [
    {}, {scts_mket_lstg_dt:'00000000'}, {scts_mket_lstg_dt:'20261027'},
    {scts_mket_lstg_dt:'20100101', scts_mket_lstg_abol_dt:'20261026'},
    {scts_mket_lstg_dt:'20100101', kosdaq_mket_lstg_dt:'20100101'},
  ]) {
    const result = parseInstrumentInfo('241690', {rt_cd:'0', output:{pdno:'241690', prdt_type_cd:'300', scty_grp_id_cd:'ST',
      scts_mket_lstg_abol_dt:'00000000', kosdaq_mket_lstg_abol_dt:'00000000', ...patch}}, '20261026');
    assert.equal(result.market, 'UNKNOWN');
  }
});

test('legacy archives are preserved and not reused or displayed as verified current signals', () => {
  for (const date of ['20261023', '20261026']) {
    const data = archive(date);
    assert.equal(Object.values(classifiedSignals(data)).flat().length, 0);
    const html = renderToStaticMarkup(createElement(SignalView, {data}));
    assert.doesNotMatch(html, /Q530107|241690|KODEX 200/);
    assert.match(html, /상장시장/);
  }
  const signal = archive('20261026').signals.volumeSurge.find(s => s.stock.code === '241690')!;
  const verified = {...signal, stock:{...signal.stock, ...info('241690', 'ST', 'KOSDAQ')}};
  assert.equal(filterStockSignals([verified], '20261027').length, 0);
  assert.equal(filterStockSignals([verified], '20261026').length, 1);
});
