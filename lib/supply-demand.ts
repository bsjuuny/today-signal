import type { SupplyDemand, SupplyInvestorQuality } from '../types/stock';

export interface NetBuyObservation {
  date: string;
  quantity: number | null;
  amountMillionKrw: number | null;
}

export interface InvestorHistoryRow {
  date: string;
  instNetBuy: number | null;
  instNetBuyAmt: number | null;
  foreignNetBuy: number | null;
  foreignNetBuyAmt: number | null;
}

type Investor = 'inst' | 'foreign';

function direction(quantity: number | null, amount: number | null): SupplyInvestorQuality['direction'] {
  if (quantity === null || amount === null || quantity === 0 || amount === 0) return 'indeterminate';
  return Math.sign(quantity) === Math.sign(amount) ? 'consistent' : 'mismatch';
}

function estimatedAmountMillionKrw(quantity: number | null, price: number): number | null {
  if (quantity === null || !Number.isFinite(price) || price <= 0) return null;
  return (quantity * price) / 1_000_000;
}

function resolveInvestor(
  investor: Investor,
  expectedDate: string,
  price: number,
  ranking: NetBuyObservation | null,
  sameDayHistory: InvestorHistoryRow | undefined,
) {
  const qtyKey = investor === 'inst' ? 'instNetBuy' : 'foreignNetBuy';
  const amountKey = investor === 'inst' ? 'instNetBuyAmt' : 'foreignNetBuyAmt';
  const issues: string[] = [];
  const usableRanking = ranking?.date === expectedDate ? ranking : null;
  if (ranking && ranking.date !== expectedDate) issues.push(`${investor}:ranking_date_mismatch:${ranking.date}`);

  // 수량과 금액은 반드시 같은 응답 행(snapshot)에서 선택한다. ranking이 부분 결측이면
  // 같은 거래일 history의 완전한 쌍을 사용하고, 둘을 필드별로 섞지 않는다.
  const rankingComplete = usableRanking?.quantity !== null && usableRanking?.quantity !== undefined
    && usableRanking.amountMillionKrw !== null;
  const historyComplete = sameDayHistory?.[qtyKey] !== null && sameDayHistory?.[qtyKey] !== undefined
    && sameDayHistory[amountKey] !== null;
  if (usableRanking && !rankingComplete && historyComplete) issues.push(`${investor}:ranking_partial_fallback_history`);
  const snapshot = rankingComplete ? 'ranking' : historyComplete ? 'history'
    : usableRanking ? 'ranking' : sameDayHistory ? 'history' : 'missing';
  const quantity = snapshot === 'ranking' ? usableRanking?.quantity ?? null
    : snapshot === 'history' ? sameDayHistory?.[qtyKey] ?? null : null;
  const amount = snapshot === 'ranking' ? usableRanking?.amountMillionKrw ?? null
    : snapshot === 'history' ? sameDayHistory?.[amountKey] ?? null : null;
  const quantitySource: SupplyInvestorQuality['quantitySource'] = quantity === null ? 'missing' : snapshot;
  const amountSource: SupplyInvestorQuality['amountSource'] = amount === null ? 'missing' : snapshot;

  if (quantitySource === 'missing') issues.push(`${investor}:quantity_missing`);
  if (amountSource === 'missing') issues.push(`${investor}:amount_missing`);
  const resolvedDirection = direction(quantity, amount);
  if (resolvedDirection === 'mismatch') issues.push(`${investor}:quantity_amount_direction_mismatch`);

  return {
    quantity,
    amount,
    estimatedAmount: estimatedAmountMillionKrw(quantity, price),
    quality: {
      observationDate: snapshot === 'ranking' ? usableRanking?.date ?? null
        : snapshot === 'history' ? sameDayHistory?.date ?? null : null,
      quantitySource,
      amountSource,
      direction: resolvedDirection,
      issues,
    } satisfies SupplyInvestorQuality,
  };
}

function consecutiveRows(
  expectedDate: string,
  history: InvestorHistoryRow[],
  instQuantity: number | null,
  foreignQuantity: number | null,
): InvestorHistoryRow[] {
  if (history[0]?.date === expectedDate) return history;
  // 장중 history가 전일까지 확정된 경우, 같은 거래일 ranking 관측값을 오늘 행으로 붙여
  // 연속 일수만 계산한다. 금액 보완에는 이 합성 행을 사용하지 않는다.
  if (instQuantity === null && foreignQuantity === null) return history;
  return [{
    date: expectedDate,
    instNetBuy: instQuantity,
    instNetBuyAmt: null,
    foreignNetBuy: foreignQuantity,
    foreignNetBuyAmt: null,
  }, ...history];
}

export function calculateConsecutiveDays(history: InvestorHistoryRow[], investor: Investor): number {
  const key = investor === 'inst' ? 'instNetBuy' : 'foreignNetBuy';
  const first = history[0]?.[key];
  if (first === null || first === undefined || first === 0) return 0;
  const sign = Math.sign(first);
  let count = 0;
  for (const row of history) {
    const value = row[key];
    if (value === null || value === 0 || Math.sign(value) !== sign) break;
    count++;
  }
  return sign * count;
}

/** 동일 거래일 관측값만 결합하고, 실제 거래대금과 수량×종가 추정액을 분리한다. */
export function reconcileSupplyDemand(args: {
  code: string;
  expectedDate: string;
  price: number;
  instRanking: NetBuyObservation | null;
  foreignRanking: NetBuyObservation | null;
  history: InvestorHistoryRow[];
}): SupplyDemand {
  const sameDayHistory = args.history.find(row => row.date === args.expectedDate);
  const inst = resolveInvestor('inst', args.expectedDate, args.price, args.instRanking, sameDayHistory);
  const foreign = resolveInvestor('foreign', args.expectedDate, args.price, args.foreignRanking, sameDayHistory);
  const streakHistory = consecutiveRows(args.expectedDate, args.history, inst.quantity, foreign.quantity);
  const issues = [...inst.quality.issues, ...foreign.quality.issues];
  if (!sameDayHistory && args.history.length > 0) issues.push(`history_date_mismatch:${args.history[0].date}`);

  return {
    code: args.code,
    instNetBuy: inst.quantity,
    instNetBuyAmt: inst.amount,
    instNetBuyEstimatedAmt: inst.estimatedAmount,
    instConsecutiveDays: calculateConsecutiveDays(streakHistory, 'inst'),
    foreignNetBuy: foreign.quantity,
    foreignNetBuyAmt: foreign.amount,
    foreignNetBuyEstimatedAmt: foreign.estimatedAmount,
    foreignConsecutiveDays: calculateConsecutiveDays(streakHistory, 'foreign'),
    foreignHoldPct: 0,
    netBuyAmtUnit: 'MILLION_KRW',
    quality: { expectedDate: args.expectedDate, inst: inst.quality, foreign: foreign.quality, issues },
  };
}

/** 실제 금액과 수량이 모두 순매수 방향일 때만 점수에 사용할 수 있다. */
export function trustedNetBuyAmount100M(supply: SupplyDemand, investor: Investor): number | null {
  const quantity = investor === 'inst' ? supply.instNetBuy : supply.foreignNetBuy;
  const amountMillionKrw = investor === 'inst' ? supply.instNetBuyAmt : supply.foreignNetBuyAmt;
  const quality = supply.quality?.[investor];
  if (quality && (
    quality.observationDate !== supply.quality!.expectedDate
    || quality.quantitySource === 'missing'
    || quality.amountSource === 'missing'
    || quality.quantitySource !== quality.amountSource
    || quality.direction === 'mismatch'
  )) return null;
  if (quantity === null || amountMillionKrw === null) return null;
  if (!Number.isFinite(quantity) || !Number.isFinite(amountMillionKrw)) return null;
  if (quantity <= 0 || amountMillionKrw <= 0) return null;
  if (Math.sign(quantity) !== Math.sign(amountMillionKrw)) return null;
  return amountMillionKrw / 100;
}

/** 쌍끌이 판정은 두 투자자 값이 같은 거래일·같은 종류의 snapshot일 때만 허용한다. */
export function hasComparableInvestorSnapshots(supply: SupplyDemand): boolean {
  if (!supply.quality) return true; // 명시적 품질 메타데이터가 없던 과거 아카이브 호환
  const { expectedDate, inst, foreign } = supply.quality;
  return inst.observationDate === expectedDate
    && foreign.observationDate === expectedDate
    && inst.quantitySource === inst.amountSource
    && foreign.quantitySource === foreign.amountSource
    && inst.quantitySource === foreign.quantitySource;
}
