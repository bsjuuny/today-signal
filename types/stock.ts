/**
 * 주식 투자 신호 서비스 — 공통 타입 정의
 */

/** 종목 기본 정보 */
export interface StockItem {
  code: string;         // 종목코드 (6자리)
  name: string;         // 종목명
  market: 'KOSPI' | 'KOSDAQ';
  price: number;        // 현재가(종가)
  priceChange: number;  // 전일 대비 등락 (원)
  changePct: number;    // 전일 대비 등락률 (%)
  open: number;         // 시가
  high: number;         // 고가
  low: number;          // 저가
  volume: number;       // 거래량
  avgVolume20: number;  // 20일 평균 거래량
  marketCap: number;    // 시가총액 (억원)
}

/** 수급 데이터 */
export interface SupplyDemand {
  code: string;
  instNetBuy: number;        // 기관 순매수 (주)
  instNetBuyAmt: number;     // 기관 순매수 금액 (원)
  instConsecutiveDays: number; // 기관 연속 순매수 일수 (양수=매수, 음수=매도)
  foreignNetBuy: number;     // 외국인 순매수 (주)
  foreignNetBuyAmt: number;  // 외국인 순매수 금액 (원)
  foreignConsecutiveDays: number; // 외국인 연속 순매수 일수
  foreignHoldPct: number;    // 외국인 보유 비중 (%)
}

/** 시장 컨텍스트 */
export interface MarketContext {
  kospiChange: number;    // 코스피 등락률 (%)
  kosdaqChange: number;   // 코스닥 등락률 (%)
  kospiVolume: number;    // 코스피 거래대금 (억원)
  vix?: number;           // VIX (선택)
  isIntraday: boolean;    // 장중 여부 (09:00~15:30 KST)
  fetchedAt: string;
}

/** 신호 등급 */
export type SignalGrade = 'A' | 'B' | 'C';  // A=강력, B=보통, C=관심

/** 신호 카테고리 */
export type SignalCategory =
  | 'INST_BUY'       // 기관 순매수
  | 'FOREIGN_BUY'    // 외국인 매집
  | 'VOLUME_SURGE'   // 거래량 급등
  | 'STRONG_DEMAND'; // 강한 수급 (복합)

/** 스코어 계산 이유 */
export interface ScoreReason {
  label: string;
  score: number;
  direction?: 'bullish' | 'bearish' | 'neutral';
}

/** 종목 신호 */
export interface StockSignal {
  stock: StockItem;
  supply: SupplyDemand;
  category: SignalCategory;
  grade: SignalGrade;
  score: number;
  reasons: ScoreReason[];   // 선정 근거 목록
  passedFilter: boolean;
}

/** 저장 데이터 구조 */
export interface TodaySignalData {
  date: string;             // YYYYMMDD
  market: MarketContext;
  signals: {
    instBuy: StockSignal[];     // 기관 순매수 TOP 5
    foreignBuy: StockSignal[];  // 외국인 매집 TOP 5
    volumeSurge: StockSignal[]; // 거래량 급등 TOP 5
    strongDemand: StockSignal[]; // 강한 수급 후보 TOP 10
  };
  updatedAt: string;
}
