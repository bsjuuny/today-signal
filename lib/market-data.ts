import type { MarketContext } from '../types/stock';

/** Strict decimal parsing: blanks, partial numbers, NaN and Infinity are missing. */
export function parseMarketNumber(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export interface IndexQuote {
  name: string;
  currentPrice: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  tradingValue: number | null; // raw KIS index value, NOT stock quote KRW
  issues: string[];
  raw: Record<string, unknown>;
}

export function parseIndexQuote(data: Record<string, unknown>, code: string): IndexQuote {
  const issues: string[] = [];
  const output = data.output;
  const o = output && typeof output === 'object' && !Array.isArray(output)
    ? output as Record<string, unknown> : {};
  if (data.rt_cd !== '0') issues.push(`api_error:${String(data.msg_cd ?? data.rt_cd)}`);
  const read = (field: string, minimum = -Infinity) => {
    const n = parseMarketNumber(o[field]);
    if (n === null || n < minimum) { issues.push(`invalid:${field}`); return null; }
    return n;
  };
  const currentPrice = read('bstp_nmix_prpr', Number.MIN_VALUE);
  const change = read('bstp_nmix_prdy_vrss');
  let changePct = read('bstp_nmix_prdy_ctrt');
  const volume = read('acml_vol', 0);
  const tradingValue = read('acml_tr_pbmn', 0);
  if (changePct !== null && change !== null) {
    const sign = String(o.prdy_vrss_sign ?? '');
    // The sign follows the point change: a tiny move (e.g. +0.04pt on 5550)
    // rounds the rate to 0.00 while change and sign stay non-flat. A zero
    // rate with a non-zero change is then judged by the rate tolerance below.
    if ((changePct !== 0 && change === 0)
      || (change > 0 && !['1', '2'].includes(sign))
      || (change < 0 && !['4', '5'].includes(sign))
      || (change === 0 && sign !== '3')
      || (changePct * change < 0)) {
      issues.push('inconsistent:change'); changePct = null;
    } else if (currentPrice !== null && currentPrice - change > 0
      && Math.abs(change / (currentPrice - change) * 100 - changePct) > 0.02) {
      issues.push('inconsistent:change_rate'); changePct = null;
    }
  }
  // A live current-index response has no business date. Zero activity cannot
  // establish that a pre-open/reset response belongs to the requested session.
  if (volume === 0 || tradingValue === 0) issues.push('unavailable:no_activity');
  if (issues.length) changePct = null;
  return { name: code === '0001' ? 'KOSPI' : 'KOSDAQ', currentPrice, change,
    changePct, volume, tradingValue, issues,
    raw: Object.fromEntries(['bstp_nmix_prpr', 'bstp_nmix_prdy_vrss', 'bstp_nmix_prdy_ctrt',
      'prdy_vrss_sign', 'acml_vol', 'acml_tr_pbmn'].map(k => [k, o[k] ?? null])) };
}

export function isMarketUsable(market: MarketContext): boolean {
  return market.quality?.status === 'valid'
    && Number.isFinite(market.kospiChange) && Number.isFinite(market.kosdaqChange)
    && typeof market.kospiVolume === 'number' && market.kospiVolume > 0;
}

export function buildMarketContext(kospi: IndexQuote, kosdaq: IndexQuote, isIntraday: boolean, now = new Date()): MarketContext {
  const kst = new Date(now.getTime() + 9 * 3600000);
  const beforeOpen = kst.getUTCHours() < 9 || [0, 6].includes(kst.getUTCDay());
  const issues = [...kospi.issues.map(x => `kospi:${x}`), ...kosdaq.issues.map(x => `kosdaq:${x}`)];
  if (beforeOpen) issues.push('session:current_index_unavailable');
  // The official REST schema does not declare a monetary unit. Require an
  // operator-confirmed contract instead of guessing from the magnitude.
  const unit = process.env.KIS_INDEX_TRADING_VALUE_UNIT;
  const divisor = unit === 'KRW' ? 100000000 : unit === 'MILLION_KRW' ? 100 : null;
  if (divisor === null) issues.push('unit:unconfirmed');
  return {
    kospiChange: beforeOpen ? null : kospi.changePct,
    kosdaqChange: beforeOpen ? null : kosdaq.changePct,
    kospiVolume: divisor !== null && kospi.tradingValue !== null ? kospi.tradingValue / divisor : null,
    isIntraday, fetchedAt: now.toISOString(),
    quality: { status: issues.length ? 'unavailable' : 'valid', issues, source: 'KIS:FHPUP02100000',
      tradingValueUnit: divisor === null ? 'UNKNOWN' : unit as 'KRW' | 'MILLION_KRW',
      raw: { kospi: kospi.raw, kosdaq: kosdaq.raw } },
  };
}
