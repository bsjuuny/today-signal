/**
 * 투자 신호 스코어링 엔진
 * 필수 조건(Hard filter) → 가점(Score) → 등급 결정
 */

import { StockItem, SupplyDemand, MarketContext, StockSignal, SignalGrade, ScoreReason } from '@/types/stock';

/** 시장 전체 신호 억제 여부 */
export function isMarketSuppressed(market: MarketContext): boolean {
  if (market.kospiChange <= -1.5) return true;
  if (market.kosdaqChange <= -2.0) return true;
  if (market.vix && market.vix >= 30) return true;
  return false;
}

/** 시장 약세 시 점수 보정 배율 */
export function marketMultiplier(market: MarketContext): number {
  if (market.vix && market.vix >= 25) return 0.7;
  if (market.kospiChange <= -1.0) return 0.8;
  return 1.0;
}

// ──────────────────────────────────────────────
// 공통 유효성 검사 및 헬퍼 함수
// ──────────────────────────────────────────────
// 파생ETF 영구 제외 (계좌 미신청)
const EXCLUDED_CODES = new Set([
  '122630', // KODEX 레버리지
  '252670', // KODEX 200선물인버스2X
  '114870', // KODEX 200선물인버스
  '233740', // KODEX 코스닥150레버리지
  '251340', // KODEX 코스닥150선물인버스
  '114800', // KODEX 인버스
  '462330', // KODEX 2차전지산업레버리지
]);

/** 거래대금을 억원 단위로 환산 (단순 계산: 종가 * 거래량 / 1억) */
function getTradingValue100M(stock: StockItem): number {
  return (stock.price * stock.volume) / 100000000;
}

/** 순매수 금액을 억원 단위로 환산 */
function getNetBuyAmt100M(netBuyShares: number, price: number): number {
  return (netBuyShares * price) / 100000000;
}

/** 1. 소외주/잡주 기본 필터 */
function isValidStock(stock: StockItem): boolean {
  if (stock.price <= 0) return false;
  if (stock.marketCap < 500) return false; // 500억 미만 제외 (세력 장난 방지)
  if (stock.price < 1000) return false;    // 1,000원 미만 동전주 제외
  if (EXCLUDED_CODES.has(stock.code)) return false; // 파생ETF 제외
  return true;
}

/** 2. 떨어지는 칼날 (장대음봉) 필터 */
function isStrongYinCandle(stock: StockItem): boolean {
  if (stock.open > stock.price) {
    const dropPct = ((stock.open - stock.price) / stock.open) * 100;
    if (dropPct >= 3) return true; // 3% 이상 크게 밀린 장대음봉
  }
  return false;
}

// ──────────────────────────────────────────────
// 1. 기관 순매수 신호
// ──────────────────────────────────────────────
export function scoreInstBuy(
  stock: StockItem,
  supply: SupplyDemand,
  market: MarketContext
): StockSignal | null {
  // ── 필수 조건 (Hard Filters) ──
  if (!isValidStock(stock)) return null;
  if (isStrongYinCandle(stock)) return null; // 음봉 투매 배제
  
  const instNetBuyAmt100M = getNetBuyAmt100M(supply.instNetBuy, stock.price);
  if (instNetBuyAmt100M < 3) return null; // 최소 3억 이상 순매수해야 유의미한 수급으로 인정

  if (market.isIntraday) {
    if (stock.changePct < -3) return null;
  } else {
    // 장마감: 양봉 마감 필수
    if (stock.price <= stock.open) return null;
    if (stock.changePct < 0) return null;
  }

  const reasons: ScoreReason[] = [];
  let score = 0;

  // ── 가점 (Scoring) ──
  if (instNetBuyAmt100M >= 30) {
    score += 30; reasons.push({ label: `기관 강력매수 ${Math.round(instNetBuyAmt100M)}억`, score: 30 });
  } else if (instNetBuyAmt100M >= 10) {
    score += 20; reasons.push({ label: `기관 순매수 ${Math.round(instNetBuyAmt100M)}억`, score: 20 });
  } else {
    score += 10; reasons.push({ label: `기관 매수세 유입`, score: 10 });
  }

  if (supply.instConsecutiveDays >= 3) {
    score += 15; reasons.push({ label: `기관 연속 ${supply.instConsecutiveDays}일 매집`, score: 15 });
  }

  const foreignNetBuyAmt100M = getNetBuyAmt100M(supply.foreignNetBuy, stock.price);
  if (foreignNetBuyAmt100M >= 3) {
    score += 20; reasons.push({ label: '외국인 동반 매수 (쌍끌이)', score: 20 });
  }

  if (stock.avgVolume20 > 0) {
    const volRatio = stock.volume / stock.avgVolume20;
    if (volRatio >= 2) {
      score += 10; reasons.push({ label: `거래량 평균 ${volRatio.toFixed(1)}배`, score: 10 });
    }
  }

  // 강한 마감/상승 (고가 97% 이상)
  if (!market.isIntraday && stock.high > 0 && stock.price / stock.high >= 0.97) {
    score += 10; reasons.push({ label: '강한 종가 방어', score: 10 });
  } else if (market.isIntraday && stock.changePct >= 1) {
    score += 10; reasons.push({ label: `장중 상승 +${stock.changePct.toFixed(1)}%`, score: 10 });
  }

  score = Math.round(score * marketMultiplier(market));

  return {
    stock, supply, category: 'INST_BUY', grade: gradeFromScore(score),
    score, reasons, passedFilter: true,
  };
}

// ──────────────────────────────────────────────
// 2. 외국인 매집 신호
// ──────────────────────────────────────────────
export function scoreForeignBuy(
  stock: StockItem,
  supply: SupplyDemand,
  market: MarketContext
): StockSignal | null {
  // ── 필수 조건 ──
  if (!isValidStock(stock)) return null;
  if (isStrongYinCandle(stock)) return null;
  if (supply.foreignConsecutiveDays < 2) return null;
  
  const foreignNetBuyAmt100M = getNetBuyAmt100M(supply.foreignNetBuy, stock.price);
  if (foreignNetBuyAmt100M < 3 && supply.foreignConsecutiveDays < 3) return null; // 금액이 작으면 연속 3일은 되어야 인정

  // 외국인 매수라도 주가가 방어되지 않으면(음봉 마감) 탈락
  if (!market.isIntraday && stock.price <= stock.open) return null;

  const reasons: ScoreReason[] = [];
  let score = 0;

  // ── 가점 ──
  if (supply.foreignConsecutiveDays >= 5) {
    score += 30; reasons.push({ label: `외국인 연속 ${supply.foreignConsecutiveDays}일 매집`, score: 30 });
  } else {
    score += 15; reasons.push({ label: `외국인 연속 ${supply.foreignConsecutiveDays}일 순매수`, score: 15 });
  }

  if (foreignNetBuyAmt100M >= 10) {
    score += 20; reasons.push({ label: `외국인 순매수 ${Math.round(foreignNetBuyAmt100M)}억`, score: 20 });
  }

  const instNetBuyAmt100M = getNetBuyAmt100M(supply.instNetBuy, stock.price);
  if (instNetBuyAmt100M >= 3) {
    score += 20; reasons.push({ label: '기관 동반 매수 (쌍끌이)', score: 20 });
  }

  if (stock.changePct > 0) {
    score += 10; reasons.push({ label: '주가 상승 동반', score: 10 });
  }

  score = Math.round(score * marketMultiplier(market));

  return {
    stock, supply, category: 'FOREIGN_BUY', grade: gradeFromScore(score),
    score, reasons, passedFilter: true,
  };
}

// ──────────────────────────────────────────────
// 3. 거래량 급등 신호 (돌파 매매용)
// ──────────────────────────────────────────────
export function scoreVolumeSurge(
  stock: StockItem,
  supply: SupplyDemand,
  market: MarketContext
): StockSignal | null {
  // ── 필수 조건 ──
  if (!isValidStock(stock)) return null;
  
  const tradingValue100M = getTradingValue100M(stock);
  if (tradingValue100M < 300) return null; // 거래대금 300억 이상 필수 (돈이 안 몰린 가짜 급등 제외)

  const volRatio = stock.avgVolume20 > 0 ? stock.volume / stock.avgVolume20 : 0;
  if (volRatio < 2) return null;

  if (market.isIntraday) {
    if (stock.changePct < 0.5) return null;
  } else {
    if (stock.price <= stock.open) return null;
    if (stock.changePct < 0.5) return null;
    // 윗꼬리 강력 제한 (고가 대비 7% 이내 마감) - 15% 허용에서 대폭 강화
    if (stock.high > 0 && stock.price / stock.high < 0.93) return null;
  }

  const reasons: ScoreReason[] = [];
  let score = 0;

  // ── 가점 ──
  if (tradingValue100M >= 1000) {
    score += 20; reasons.push({ label: `초대형 거래대금 ${Math.round(tradingValue100M)}억`, score: 20 });
  } else if (tradingValue100M >= 500) {
    score += 10; reasons.push({ label: `대규모 거래대금 ${Math.round(tradingValue100M)}억`, score: 10 });
  }

  if (volRatio >= 5) {
    score += 20; reasons.push({ label: `거래량 ${volRatio.toFixed(0)}배 폭발`, score: 20 });
  } else {
    score += 10; reasons.push({ label: `거래량 ${volRatio.toFixed(1)}배 유입`, score: 10 });
  }

  const instAmt = getNetBuyAmt100M(supply.instNetBuy, stock.price);
  const forAmt = getNetBuyAmt100M(supply.foreignNetBuy, stock.price);
  if (instAmt >= 5 && forAmt >= 5) {
    score += 30; reasons.push({ label: '메이저 쌍끌이 매수 가담', score: 30 });
  } else if (instAmt >= 3 || forAmt >= 3) {
    score += 10; reasons.push({ label: '메이저 수급 확인', score: 10 });
  }

  if (stock.changePct >= 5) {
    score += 10; reasons.push({ label: `+${stock.changePct.toFixed(1)}% 급등`, score: 10 });
  }

  score = Math.round(score * marketMultiplier(market));

  return {
    stock, supply, category: 'VOLUME_SURGE', grade: gradeFromScore(score),
    score, reasons, passedFilter: true,
  };
}

// ──────────────────────────────────────────────
// 4. 강한 수급 후보 (복합 신호 - 메이저 쌍끌이 등)
// ──────────────────────────────────────────────
export function scoreStrongDemand(
  stock: StockItem,
  supply: SupplyDemand,
  market: MarketContext
): StockSignal | null {
  if (!isValidStock(stock)) return null;
  if (stock.changePct > 25) return null; // 상한가 직전 제외 (기존 9%에서 대폭 완화하여 주도주 포함)
  if (isStrongYinCandle(stock)) return null;

  const tradingValue100M = getTradingValue100M(stock);
  const instAmt = getNetBuyAmt100M(supply.instNetBuy, stock.price);
  const forAmt = getNetBuyAmt100M(supply.foreignNetBuy, stock.price);

  const isTwinBuy = instAmt >= 3 && forAmt >= 3;
  const hasInstAndVol = instAmt >= 5 && stock.avgVolume20 > 0 && (stock.volume / stock.avgVolume20 >= 2);
  
  if (!isTwinBuy && !hasInstAndVol && supply.foreignConsecutiveDays < 3) return null;

  if (!market.isIntraday) {
    if (stock.price <= stock.open) return null;
    if (stock.changePct < 0) return null;
    if (stock.high > 0 && stock.price / stock.high < 0.93) return null; // 윗꼬리 필터 방어
  }

  const reasons: ScoreReason[] = [];
  let score = 0;

  if (isTwinBuy) {
    score += 40; reasons.push({ label: `강력 쌍끌이 (기관 ${Math.round(instAmt)}억, 외인 ${Math.round(forAmt)}억)`, score: 40 });
  } else if (instAmt >= 10) {
    score += 20; reasons.push({ label: `기관 주도 매수 ${Math.round(instAmt)}억`, score: 20 });
  }

  const volRatio = stock.avgVolume20 > 0 ? stock.volume / stock.avgVolume20 : 0;
  if (volRatio >= 3) {
    score += 15; reasons.push({ label: `거래량 ${volRatio.toFixed(1)}배`, score: 15 });
  }

  if (tradingValue100M >= 500) {
    score += 15; reasons.push({ label: `풍부한 거래대금 ${Math.round(tradingValue100M)}억`, score: 15 });
  }

  score = Math.round(score * marketMultiplier(market));
  if (score < (market.isIntraday ? 40 : 50)) return null;

  let grade = gradeFromScore(score);
  // 쌍끌이는 프리미엄을 주어 등급 상향
  if (isTwinBuy && grade === 'C') grade = 'B';

  return {
    stock, supply, category: 'STRONG_DEMAND', grade,
    score, reasons, passedFilter: true,
  };
}

// ──────────────────────────────────────────────
// 5. 당일 모멘텀 신호 (단타 전용)
// ──────────────────────────────────────────────
export function scoreMomentum(
  stock: StockItem,
  market: MarketContext
): StockSignal | null {
  if (!isValidStock(stock)) return null;
  if (stock.changePct > 25) return null;  
  if (stock.marketCap > 5000) return null; // 대형주 제외 (변동성 부족)

  const volRatio = stock.avgVolume20 > 0 ? stock.volume / stock.avgVolume20 : 0;
  const tradingValue100M = getTradingValue100M(stock);

  // 필수: 거래량 3배+ AND 등락률 3%+ AND 거래대금 300억+
  if (volRatio < 3) return null;
  if (stock.changePct < 3) return null;
  if (tradingValue100M < 300) return null;

  if (!market.isIntraday) {
    if (stock.high > 0 && stock.price / stock.high < 0.93) return null; // 윗꼬리 강력 방어
    if (stock.price <= stock.open) return null; // 당일 양봉 유지
  }

  const reasons: ScoreReason[] = [];
  let score = 0;

  if (tradingValue100M >= 1000) {
    score += 25; reasons.push({ label: `초대형 거래대금 ${Math.round(tradingValue100M)}억`, score: 25 });
  } else {
    score += 10; reasons.push({ label: `거래대금 ${Math.round(tradingValue100M)}억 통과`, score: 10 });
  }

  if (volRatio >= 10) {
    score += 25; reasons.push({ label: `거래량 ${volRatio.toFixed(0)}배 폭주`, score: 25 });
  } else {
    score += 15; reasons.push({ label: `거래량 ${volRatio.toFixed(1)}배`, score: 15 });
  }

  if (stock.changePct >= 10) {
    score += 20; reasons.push({ label: `+${stock.changePct.toFixed(1)}% 강세파동`, score: 20 });
  } else {
    score += 10; reasons.push({ label: `+${stock.changePct.toFixed(1)}% 상승`, score: 10 });
  }

  if (stock.high > 0) {
    const highRatio = stock.price / stock.high;
    if (highRatio >= 0.98) {
      score += 15; reasons.push({ label: '고가 근접 마감 (돌파 형태)', score: 15 });
    }
  }

  score = Math.round(score * marketMultiplier(market));
  if (score < 45) return null;

  // supply는 momentum에서 미사용 — 빈 객체로 채움
  const emptySupply: import('@/types/stock').SupplyDemand = {
    code: stock.code,
    instNetBuy: 0, instNetBuyAmt: 0, instConsecutiveDays: 0,
    foreignNetBuy: 0, foreignNetBuyAmt: 0, foreignConsecutiveDays: 0,
    foreignHoldPct: 0,
  };

  return {
    stock, supply: emptySupply, category: 'MOMENTUM', grade: gradeFromScore(score),
    score, reasons, passedFilter: true,
  };
}

// ──────────────────────────────────────────────
// 등급 변환
// ──────────────────────────────────────────────
function gradeFromScore(score: number): SignalGrade {
  if (score >= 70) return 'A';
  if (score >= 45) return 'B';
  return 'C';
}
