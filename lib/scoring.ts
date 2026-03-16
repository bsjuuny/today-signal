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
// 공통 유효성 검사
// ──────────────────────────────────────────────
function isValidStock(stock: StockItem): boolean {
  if (stock.price <= 0) return false;
  if (stock.marketCap < 200) return false; // 200억 미만 제외
  return true;
}

// ──────────────────────────────────────────────
// 1. 기관 순매수 신호
// ──────────────────────────────────────────────
export function scoreInstBuy(
  stock: StockItem,
  supply: SupplyDemand,
  market: MarketContext
): StockSignal | null {
  // ── 필수 조건 ──
  if (!isValidStock(stock)) return null;
  if (supply.instNetBuy <= 0) return null;           // 기관 순매수 > 0
  if (stock.marketCap < 500) return null;             // 500억 이상
  if (market.isIntraday) {
    // 장중: 등락률 -1% 이상만 (급락 종목 제외)
    if (stock.changePct < -1) return null;
  } else {
    // 장마감: 양봉 + 플러스 마감 필수
    if (stock.price <= stock.open) return null;
    if (stock.changePct < 0) return null;
  }

  const reasons: ScoreReason[] = [];
  let score = 0;

  // ── 가점 ──
  if (supply.instConsecutiveDays >= 3) {
    score += 25; reasons.push({ label: `기관 연속 ${supply.instConsecutiveDays}일 순매수`, score: 25 });
  } else if (supply.instConsecutiveDays >= 2) {
    score += 15; reasons.push({ label: '기관 연속 2일 순매수', score: 15 });
  } else {
    score += 5; reasons.push({ label: '기관 당일 순매수', score: 5 });
  }

  if (supply.foreignNetBuy > 0) {
    score += 20; reasons.push({ label: '외국인 동반 순매수', score: 20 });
  }

  if (stock.avgVolume20 > 0) {
    const volRatio = stock.volume / stock.avgVolume20;
    if (volRatio >= 2) {
      score += 10; reasons.push({ label: `거래량 평균 ${volRatio.toFixed(1)}배`, score: 10 });
    }
  }

  // 강한 마감/상승 (장마감: 고가 97% 이상 / 장중: 상승 중이면 가점)
  if (!market.isIntraday && stock.high > 0 && stock.price / stock.high >= 0.97) {
    score += 10; reasons.push({ label: '강한 마감 (고가 근접)', score: 10 });
  } else if (market.isIntraday && stock.changePct >= 1) {
    score += 10; reasons.push({ label: `장중 상승 +${stock.changePct.toFixed(1)}%`, score: 10 });
  }

  score = Math.round(score * marketMultiplier(market));

  return {
    stock,
    supply,
    category: 'INST_BUY',
    grade: gradeFromScore(score),
    score,
    reasons,
    passedFilter: true,
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
  if (supply.foreignConsecutiveDays < 3) return null;  // 연속 3일+ 필수
  if (stock.marketCap < 1000) return null;              // 1,000억 이상 (외국인 담을 규모)

  const reasons: ScoreReason[] = [];
  let score = 0;

  // ── 가점 ──
  if (supply.foreignConsecutiveDays >= 10) {
    score += 35; reasons.push({ label: `외국인 연속 ${supply.foreignConsecutiveDays}일 매집`, score: 35 });
  } else if (supply.foreignConsecutiveDays >= 5) {
    score += 20; reasons.push({ label: `외국인 연속 ${supply.foreignConsecutiveDays}일 순매수`, score: 20 });
  } else {
    score += 10; reasons.push({ label: `외국인 연속 ${supply.foreignConsecutiveDays}일 순매수`, score: 10 });
  }

  if (supply.instNetBuy > 0) {
    score += 20; reasons.push({ label: '기관 동반 순매수', score: 20 });
  }

  if (supply.foreignHoldPct > 0) {
    // 외국인 보유 비중 증가 자체는 별도 추적 어려움, 단순 보유 비중으로 가점
    if (supply.foreignHoldPct >= 20) {
      score += 10; reasons.push({ label: `외국인 보유 ${supply.foreignHoldPct.toFixed(1)}%`, score: 10 });
    }
  }

  score = Math.round(score * marketMultiplier(market));

  return {
    stock,
    supply,
    category: 'FOREIGN_BUY',
    grade: gradeFromScore(score),
    score,
    reasons,
    passedFilter: true,
  };
}

// ──────────────────────────────────────────────
// 3. 거래량 급등 신호
// ──────────────────────────────────────────────
export function scoreVolumeSurge(
  stock: StockItem,
  supply: SupplyDemand,
  market: MarketContext
): StockSignal | null {
  // ── 필수 조건 ──
  if (!isValidStock(stock)) return null;
  if (stock.marketCap < 200) return null;

  const volRatio = stock.avgVolume20 > 0 ? stock.volume / stock.avgVolume20 : 0;
  if (volRatio < 3) return null;                       // 평균 3배 이상 필수

  if (market.isIntraday) {
    // 장중: 거래량 폭발 + 소폭 상승이면 충분
    if (stock.changePct < 0.5) return null;
  } else {
    // 장마감: 양봉 + +0.5% 이상 + 강한 마감 필수
    if (stock.price <= stock.open) return null;
    if (stock.changePct < 0.5) return null;
    if (stock.high > 0 && stock.price / stock.high < 0.85) return null;
  }

  const reasons: ScoreReason[] = [];
  let score = 0;

  // ── 가점 ──
  if (volRatio >= 5) {
    score += 30; reasons.push({ label: `거래량 평균 ${volRatio.toFixed(0)}배 폭발`, score: 30 });
  } else if (volRatio >= 3) {
    score += 20; reasons.push({ label: `거래량 평균 ${volRatio.toFixed(1)}배`, score: 20 });
  }

  if (supply.instNetBuy > 0 && supply.foreignNetBuy > 0) {
    score += 20; reasons.push({ label: '기관+외국인 동반 매수', score: 20 });
  } else if (supply.instNetBuy > 0 || supply.foreignNetBuy > 0) {
    score += 10; reasons.push({ label: '기관/외국인 매수 가담', score: 10 });
  }

  if (stock.changePct >= 3) {
    score += 10; reasons.push({ label: `강한 상승 +${stock.changePct.toFixed(1)}%`, score: 10 });
  }

  score = Math.round(score * marketMultiplier(market));

  return {
    stock,
    supply,
    category: 'VOLUME_SURGE',
    grade: gradeFromScore(score),
    score,
    reasons,
    passedFilter: true,
  };
}

// ──────────────────────────────────────────────
// 4. 강한 수급 후보 (복합 신호)
// ──────────────────────────────────────────────
export function scoreStrongDemand(
  stock: StockItem,
  supply: SupplyDemand,
  market: MarketContext
): StockSignal | null {
  // ── STEP 1: 수급 확인 (하나라도 해당) ──
  const hasInstAndVol = supply.instNetBuy > 0 &&
    stock.avgVolume20 > 0 && stock.volume / stock.avgVolume20 >= 2;
  const hasForeignConsec = supply.foreignConsecutiveDays >= 3 && supply.instNetBuy > 0;

  if (!hasInstAndVol && !hasForeignConsec) return null;

  // ── STEP 2: 가격 패턴 확인 ──
  if (!isValidStock(stock)) return null;
  if (stock.changePct > 9) return null;                    // 상한가 제외
  if (market.isIntraday) {
    // 장중: 급락 종목만 제외 (-1% 이하)
    if (stock.changePct < -1) return null;
  } else {
    // 장마감: 양봉 + 강한 마감 필수
    if (stock.price <= stock.open) return null;
    if (stock.changePct < 1) return null;
    if (stock.high > 0 && stock.price / stock.high < 0.95) return null;
  }

  // ── STEP 3: 시장 컨텍스트 ──
  if (market.kospiChange < -0.5 && market.kosdaqChange < -0.5) return null;

  const reasons: ScoreReason[] = [];
  let score = 0;

  // ── 가점 ──
  if (supply.instNetBuy > 0 && supply.foreignNetBuy > 0) {
    score += 30; reasons.push({ label: '기관+외국인 동반 순매수', score: 30 });
  } else if (supply.instNetBuy > 0) {
    score += 15; reasons.push({ label: '기관 순매수', score: 15 });
  }

  const volRatio = stock.avgVolume20 > 0 ? stock.volume / stock.avgVolume20 : 0;
  if (volRatio >= 5) {
    score += 25; reasons.push({ label: `거래량 ${volRatio.toFixed(0)}배 폭발`, score: 25 });
  } else if (volRatio >= 2) {
    score += 15; reasons.push({ label: `거래량 ${volRatio.toFixed(1)}배`, score: 15 });
  }

  if (supply.foreignConsecutiveDays >= 3) {
    score += 20; reasons.push({ label: `외국인 연속 ${supply.foreignConsecutiveDays}일`, score: 20 });
  }

  if (supply.instConsecutiveDays >= 2) {
    score += 15; reasons.push({ label: `기관 연속 ${supply.instConsecutiveDays}일`, score: 15 });
  }

  if (stock.changePct >= 3) {
    score += 10; reasons.push({ label: `+${stock.changePct.toFixed(1)}% 강세`, score: 10 });
  }

  score = Math.round(score * marketMultiplier(market));

  // 장중: 50점 이상 / 장마감: 60점 이상
  if (score < (market.isIntraday ? 50 : 60)) return null;

  return {
    stock,
    supply,
    category: 'STRONG_DEMAND',
    grade: gradeFromScore(score),
    score,
    reasons,
    passedFilter: true,
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
