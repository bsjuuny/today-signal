import type { StockItem, StockSignal, TodaySignalData } from '../types/stock';

export type InstrumentType = 'STOCK' | 'ETF' | 'ETN' | 'UNKNOWN';
export type ListingMarket = 'KOSPI' | 'KOSDAQ' | 'UNKNOWN';
export interface InstrumentClassification {
  market: ListingMarket;
  instrumentType: InstrumentType;
  classification?: {
    source: 'KIS:CTPF1002R';
    version: 1;
    checkedOn: string;
    securityGroup: string;
  };
}

/** Live CTPF1002R pads pdno to 12 chars: 005930 → 00000A005930, Q530107 → 00000Q530107 (checked 2026-10-27). */
function matchesPdno(pdno: unknown, code: string): boolean {
  if (typeof pdno !== 'string') return false;
  const p = pdno.trim();
  return p === code || p === code.padStart(12, '0') || p === `A${code}`.padStart(12, '0');
}

/** KIS stock basic info. Neither the ticker nor the product name is a classifier. */
export function parseInstrumentInfo(code: string, response: Record<string, unknown>, date: string): InstrumentClassification {
  const unknown: InstrumentClassification = { market: 'UNKNOWN', instrumentType: 'UNKNOWN' };
  const o = response.output;
  if (response.rt_cd !== '0' || !o || typeof o !== 'object' || Array.isArray(o)) return unknown;
  const row = o as Record<string, unknown>;
  if (!matchesPdno(row.pdno, code) || row.prdt_type_cd !== '300') return unknown;
  const group = typeof row.scty_grp_id_cd === 'string' ? row.scty_grp_id_cd.trim() : '';
  const instrumentType: InstrumentType = group === 'ST' ? 'STOCK' : group === 'EF' ? 'ETF' : group === 'EN' ? 'ETN' : 'UNKNOWN';
  const active = (listed: unknown, delisted: unknown) =>
    typeof listed === 'string' && /^\d{8}$/.test(listed) && listed !== '00000000' && listed <= date &&
    (delisted === '' || delisted === '00000000' || (typeof delisted === 'string' && /^\d{8}$/.test(delisted) && delisted > date));
  const kospi = active(row.scts_mket_lstg_dt, row.scts_mket_lstg_abol_dt);
  const kosdaq = active(row.kosdaq_mket_lstg_dt, row.kosdaq_mket_lstg_abol_dt);
  const market: ListingMarket = kospi === kosdaq ? 'UNKNOWN' : kospi ? 'KOSPI' : 'KOSDAQ';
  return { market, instrumentType, classification: { source: 'KIS:CTPF1002R', version: 1, checkedOn: date, securityGroup: group } };
}

export function isClassifiedStock(stock: StockItem, date?: string): boolean {
  return stock.instrumentType === 'STOCK' && (stock.market === 'KOSPI' || stock.market === 'KOSDAQ') &&
    stock.classification?.source === 'KIS:CTPF1002R' && stock.classification.version === 1 &&
    stock.classification.securityGroup === 'ST' && (!date || stock.classification.checkedOn === date);
}

/** Old unverified classifications must not re-enter scoring or the current UI. Archives stay untouched. */
export function filterStockSignals(signals: StockSignal[], date?: string, market: 'ALL' | ListingMarket = 'ALL'): StockSignal[] {
  return signals.filter(s => isClassifiedStock(s.stock, date) && (market === 'ALL' || s.stock.market === market));
}

export function classifiedSignals(data: TodaySignalData, market: 'ALL' | ListingMarket = 'ALL'): TodaySignalData['signals'] {
  return Object.fromEntries(Object.entries(data.signals).map(([key, signals]) =>
    [key, filterStockSignals(signals, data.date, market)])) as TodaySignalData['signals'];
}

export const INSTRUMENT_LABEL = { STOCK: '기업 주식', ETF: 'ETF', ETN: 'ETN', UNKNOWN: '유형 미확인' };
