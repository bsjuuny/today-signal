import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { scoreInstBuy } from '../lib/scoring';
import { hasComparableInvestorSnapshots, reconcileSupplyDemand, trustedNetBuyAmount100M } from '../lib/supply-demand';
import type { TodaySignalData } from '../types/stock';

test('2026-11-26 Mirae Asset case uses actual amount and removes the false twin-buy bonus', () => {
  const data: TodaySignalData = JSON.parse(fs.readFileSync('public/data/history/signal_20261126.json', 'utf8'));
  const original = data.signals.instBuy.find(signal => signal.stock.code === '006800');
  assert.ok(original);
  assert.equal(original.supply.foreignNetBuy, 25286);
  assert.equal(original.supply.foreignNetBuyAmt, -8723);

  const estimatedMillionKrw = (original.supply.foreignNetBuy! * original.stock.price) / 1_000_000;
  assert.ok(Math.abs(estimatedMillionKrw - 503.94998) < 0.00001);
  assert.equal(trustedNetBuyAmount100M(original.supply, 'foreign'), null);
  assert.equal(trustedNetBuyAmount100M(original.supply, 'inst'), 133.1);

  const rescored = scoreInstBuy(original.stock, original.supply, data.market);
  assert.ok(rescored);
  assert.equal(rescored.score, 45);
  assert.equal(rescored.reasons.some(reason => reason.label.includes('쌍끌이')), false);
  assert.deepEqual(rescored.reasons.map(reason => reason.score), [30, 15]);
});

test('reconciliation keeps actual and estimated amounts separate and flags direction mismatch', () => {
  const supply = reconcileSupplyDemand({
    code: '006800', expectedDate: '20261126', price: 19930,
    instRanking: { date: '20261126', quantity: 662927, amountMillionKrw: 13310 },
    foreignRanking: { date: '20261126', quantity: 25286, amountMillionKrw: -8723 },
    history: [{
      date: '20261126', instNetBuy: 662927, instNetBuyAmt: 13310,
      foreignNetBuy: 25286, foreignNetBuyAmt: -8723,
    }],
  });
  assert.equal(supply.foreignNetBuyAmt, -8723);
  assert.ok(Math.abs(supply.foreignNetBuyEstimatedAmt! - 503.94998) < 0.00001);
  assert.equal(supply.netBuyAmtUnit, 'MILLION_KRW');
  assert.equal(supply.quality?.foreign.direction, 'mismatch');
  assert.ok(supply.quality?.issues.includes('foreign:quantity_amount_direction_mismatch'));
  assert.equal(trustedNetBuyAmount100M(supply, 'foreign'), null);
});

test('explicit zero is not replaced, while missing values only fall back to same-day history', () => {
  const history = [{
    date: '20261126', instNetBuy: 123, instNetBuyAmt: 4,
    foreignNetBuy: 456, foreignNetBuyAmt: 9,
  }];
  const supply = reconcileSupplyDemand({
    code: 'TEST', expectedDate: '20261126', price: 10000,
    instRanking: { date: '20261126', quantity: 0, amountMillionKrw: 0 },
    foreignRanking: { date: '20261126', quantity: null, amountMillionKrw: null },
    history,
  });
  assert.equal(supply.instNetBuy, 0);
  assert.equal(supply.instNetBuyAmt, 0);
  assert.equal(supply.quality?.inst.quantitySource, 'ranking');
  assert.equal(supply.quality?.inst.amountSource, 'ranking');
  assert.equal(supply.foreignNetBuy, 456);
  assert.equal(supply.foreignNetBuyAmt, 9);
  assert.equal(supply.quality?.foreign.quantitySource, 'history');
  assert.equal(supply.quality?.foreign.amountSource, 'history');
});

test('quantity and amount are never mixed across different collection snapshots', () => {
  const supply = reconcileSupplyDemand({
    code: 'TEST', expectedDate: '20261126', price: 10000,
    instRanking: { date: '20261126', quantity: 999, amountMillionKrw: null },
    foreignRanking: null,
    history: [{
      date: '20261126', instNetBuy: 123, instNetBuyAmt: 4,
      foreignNetBuy: null, foreignNetBuyAmt: null,
    }],
  });
  assert.equal(supply.instNetBuy, 123);
  assert.equal(supply.instNetBuyAmt, 4);
  assert.equal(supply.quality?.inst.quantitySource, 'history');
  assert.equal(supply.quality?.inst.amountSource, 'history');
  assert.ok(supply.quality?.issues.includes('inst:ranking_partial_fallback_history'));
});

test('twin-buy snapshots must use the same date and source', () => {
  const supply = reconcileSupplyDemand({
    code: 'TEST', expectedDate: '20261126', price: 10000,
    instRanking: { date: '20261126', quantity: 100000, amountMillionKrw: 1000 },
    foreignRanking: null,
    history: [{
      date: '20261126', instNetBuy: 90000, instNetBuyAmt: 900,
      foreignNetBuy: 100000, foreignNetBuyAmt: 1000,
    }],
  });
  assert.equal(trustedNetBuyAmount100M(supply, 'inst'), 10);
  assert.equal(trustedNetBuyAmount100M(supply, 'foreign'), 10);
  assert.equal(supply.quality?.inst.quantitySource, 'ranking');
  assert.equal(supply.quality?.foreign.quantitySource, 'history');
  assert.equal(hasComparableInvestorSnapshots(supply), false);
});

test('different-day observations never fill current supply fields', () => {
  const supply = reconcileSupplyDemand({
    code: 'TEST', expectedDate: '20261126', price: 10000,
    instRanking: { date: '20261125', quantity: 1000, amountMillionKrw: 10 },
    foreignRanking: null,
    history: [{
      date: '20261125', instNetBuy: 1000, instNetBuyAmt: 10,
      foreignNetBuy: 2000, foreignNetBuyAmt: 20,
    }],
  });
  assert.equal(supply.instNetBuy, null);
  assert.equal(supply.instNetBuyAmt, null);
  assert.equal(supply.foreignNetBuy, null);
  assert.equal(supply.foreignNetBuyAmt, null);
  assert.ok(supply.quality?.issues.includes('inst:ranking_date_mismatch:20261125'));
  assert.ok(supply.quality?.issues.includes('history_date_mismatch:20261125'));
  assert.equal(trustedNetBuyAmount100M(supply, 'inst'), null);
});

test('missing actual amount never earns a supply score from the quantity estimate', () => {
  const data: TodaySignalData = JSON.parse(fs.readFileSync('public/data/history/signal_20261126.json', 'utf8'));
  const original = data.signals.instBuy.find(signal => signal.stock.code === '006800')!;
  const missingActual = {
    ...original.supply,
    instNetBuyAmt: null,
    instNetBuyEstimatedAmt: original.supply.instNetBuy! * original.stock.price / 1_000_000,
  };
  assert.ok(missingActual.instNetBuyEstimatedAmt > 10_000);
  assert.equal(scoreInstBuy(original.stock, missingActual, data.market), null);
});
