/**
 * 투자 신호 데이터 수집 스크립트
 * GitHub Actions에서 장 마감 후 실행 (16:00 KST)
 *
 * 실행: npm run data:update
 * 필요 환경변수: KIS_APP_KEY, KIS_APP_SECRET
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'fs';
import path from 'path';
import {
  getIndexQuote, getInstNetBuyTop, getForeignNetBuyTop,
  getVolumeSurgeTop, getStockQuote, getInvestorHistory,
  calcConsecutiveDays, getAvgVolume20, sleep, getLastTradingDate,
} from '../lib/kis-api';
import {
  scoreInstBuy, scoreForeignBuy, scoreVolumeSurge, scoreStrongDemand,
  isMarketSuppressed,
} from '../lib/scoring';
import { StockItem, SupplyDemand, MarketContext, TodaySignalData, StockSignal } from '../types/stock';

const OUTPUT_PATH = path.join(process.cwd(), 'public', 'data', 'today_signal.json');

function today(): string {
  return getLastTradingDate();
}

async function buildStockItem(code: string, name: string, price: number, changePct: number, volume: number): Promise<StockItem> {
  const quote = await getStockQuote(code);
  await sleep(150);
  const avgVol = await getAvgVolume20(code);
  return {
    code,
    name: name || quote.name,
    market: 'KOSPI', // KIS API 응답에 따라 조정 가능
    price: quote.price || price,
    priceChange: quote.priceChange,
    changePct: quote.changePct || changePct,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    volume: quote.volume || volume,
    avgVolume20: avgVol,
    marketCap: quote.marketCap,
  };
}

async function buildSupply(code: string, instNetBuy: number, foreignNetBuy: number): Promise<SupplyDemand> {
  const history = await getInvestorHistory(code, 10);
  await sleep(150);
  const instConsec = calcConsecutiveDays(history, 'inst');
  const foreignConsec = calcConsecutiveDays(history, 'foreign');
  // history[0]이 가장 최근 거래일 실제 수치 — 리스트 API가 0을 반환할 때 fallback
  const actualInstNetBuy = instNetBuy !== 0 ? instNetBuy : (history[0]?.instNetBuy ?? 0);
  const actualForeignNetBuy = foreignNetBuy !== 0 ? foreignNetBuy : (history[0]?.foreignNetBuy ?? 0);
  return {
    code,
    instNetBuy: actualInstNetBuy,
    instNetBuyAmt: 0,
    instConsecutiveDays: instConsec,
    foreignNetBuy: actualForeignNetBuy,
    foreignNetBuyAmt: 0,
    foreignConsecutiveDays: foreignConsec,
    foreignHoldPct: 0,
  };
}

async function main() {
  if (!process.env.KIS_APP_KEY || !process.env.KIS_APP_SECRET) {
    console.error('[collect-data] 오류: KIS_APP_KEY, KIS_APP_SECRET 환경변수가 없습니다.');
    console.error('  https://apiportal.koreainvestment.com 에서 무료 신청 후 .env.local에 추가하세요.');
    process.exit(1);
  }

  // ── 장중 여부 판단 (KST 09:00~15:30) ──
  const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const kstHour = nowKST.getUTCHours();
  const kstMin = nowKST.getUTCMinutes();
  const kstMinutes = kstHour * 60 + kstMin;
  const isIntraday = kstMinutes >= 9 * 60 && kstMinutes < 15 * 60 + 30;

  console.log(`[collect-data] 데이터 수집 시작... (${isIntraday ? '장중' : '장마감'} 모드)`);

  // ── 1. 시장 지수 ──
  console.log('  [시장] 코스피/코스닥 지수 조회...');
  const [kospi, kosdaq] = await Promise.all([
    getIndexQuote('0001'),
    getIndexQuote('1001'),
  ]);
  await sleep(200);

  const market: MarketContext = {
    kospiChange: kospi.changePct,
    kosdaqChange: kosdaq.changePct,
    kospiVolume: Math.round(kospi.tradingValue / 100000000), // 거래대금(원) → 억원
    isIntraday,
    fetchedAt: new Date().toISOString(),
  };

  console.log(`  [시장] 코스피 ${kospi.changePct > 0 ? '+' : ''}${kospi.changePct}% / 코스닥 ${kosdaq.changePct > 0 ? '+' : ''}${kosdaq.changePct}%`);

  if (isMarketSuppressed(market)) {
    console.warn('  [시장] 시장 하락 — 신호 수집 억제됨');
  }

  // ── 2. 기관/외국인/거래량 상위 조회 ──
  console.log('  [수집] 기관 순매수 상위...');
  const instList = await getInstNetBuyTop(30).catch(e => { console.error('  [수집] 기관 조회 실패:', e.message); return []; });
  console.log(`    → ${instList.length}개 종목 수신`);
  await sleep(300);

  console.log('  [수집] 외국인 순매수 상위...');
  const foreignList = await getForeignNetBuyTop(30).catch(e => { console.error('  [수집] 외국인 조회 실패:', e.message); return []; });
  console.log(`    → ${foreignList.length}개 종목 수신`);
  await sleep(300);

  console.log('  [수집] 거래량 급등 상위...');
  const volList = await getVolumeSurgeTop(30).catch(e => { console.error('  [수집] 거래량 조회 실패:', e.message); return []; });
  console.log(`    → ${volList.length}개 종목 수신`);
  await sleep(300);

  // ── 3. 종목별 상세 데이터 + 스코어링 ──
  const processedCodes = new Set<string>();

  async function processItem(code: string, name: string, price: number, changePct: number, volume: number, instBuy: number, foreignBuy: number) {
    if (processedCodes.has(code)) return { stock: null, supply: null };
    processedCodes.add(code);
    try {
      const stock = await buildStockItem(code, name, price, changePct, volume);
      await sleep(150);
      const supply = await buildSupply(code, instBuy, foreignBuy);
      return { stock, supply };
    } catch (err) {
      console.error(`    오류 (${code}):`, err instanceof Error ? err.message : err);
      return { stock: null, supply: null };
    }
  }

  // ── 3개 리스트 통합 → 종목별 instBuy/foreignBuy 머지 후 중복 제거 ──
  const candidateMap = new Map<string, { code: string; name: string; price: number; changePct: number; volume: number; instBuy: number; foreignBuy: number }>();
  for (const i of instList) {
    candidateMap.set(i.code, { code: i.code, name: i.name, price: i.price, changePct: i.changePct, volume: i.volume, instBuy: i.netBuyQty, foreignBuy: 0 });
  }
  for (const i of foreignList) {
    const existing = candidateMap.get(i.code);
    if (existing) existing.foreignBuy = i.netBuyQty;
    else candidateMap.set(i.code, { code: i.code, name: i.name, price: i.price, changePct: i.changePct, volume: i.volume, instBuy: 0, foreignBuy: i.netBuyQty });
  }
  for (const i of volList) {
    if (!candidateMap.has(i.code)) {
      candidateMap.set(i.code, { code: i.code, name: i.name, price: i.price, changePct: i.changePct, volume: i.volume, instBuy: 0, foreignBuy: 0 });
    }
  }
  const allCandidates = [...candidateMap.values()];

  const instSignals: StockSignal[] = [];
  const foreignSignals: StockSignal[] = [];
  const volSignals: StockSignal[] = [];
  const strongSignals: StockSignal[] = [];

  console.log('\n  [스코어링] 전체 후보 처리...');
  for (const item of allCandidates) {
    const { stock, supply } = await processItem(item.code, item.name, item.price, item.changePct, item.volume, item.instBuy, item.foreignBuy);
    if (!stock || !supply) continue;

    const inst = scoreInstBuy(stock, supply, market);
    if (inst) { instSignals.push(inst); console.log(`    [기관] ✓ ${stock.name} (${stock.code}) 점수: ${inst.score}`); }

    const foreign = scoreForeignBuy(stock, supply, market);
    if (foreign) { foreignSignals.push(foreign); console.log(`    [외국인] ✓ ${stock.name} (${stock.code}) 점수: ${foreign.score}`); }

    const vol = scoreVolumeSurge(stock, supply, market);
    if (vol) { volSignals.push(vol); console.log(`    [거래량] ✓ ${stock.name} (${stock.code}) 점수: ${vol.score}`); }

    const strong = scoreStrongDemand(stock, supply, market);
    if (strong) { strongSignals.push(strong); console.log(`    [강한수급] ✓ ${stock.name} (${stock.code}) 점수: ${strong.score}`); }
  }

  // ── 4. 정렬 + TOP N 추출 ──
  const sort = (arr: typeof instSignals) => arr.sort((a, b) => b.score - a.score);

  // 기관/외국인 API가 빈 결과를 반환하면 (주말·휴장일) 이전 데이터 보존
  let prevData: TodaySignalData | null = null;
  if (fs.existsSync(OUTPUT_PATH)) {
    try { prevData = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8')); } catch {}
  }
  const noNewInstData = instList.length === 0 && instSignals.length === 0;
  const noNewForeignData = foreignList.length === 0 && foreignSignals.length === 0;

  const result: TodaySignalData = {
    date: today(),
    market,
    signals: {
      instBuy: noNewInstData && prevData ? prevData.signals.instBuy : sort(instSignals).slice(0, 5),
      foreignBuy: noNewForeignData && prevData ? prevData.signals.foreignBuy : sort(foreignSignals).slice(0, 5),
      volumeSurge: sort(volSignals).slice(0, 5),
      strongDemand: sort(strongSignals).slice(0, 10),
    },
    updatedAt: new Date().toISOString(),
  };

  if (noNewInstData && prevData) console.log('  [기관] 데이터 없음 — 이전 신호 유지');
  if (noNewForeignData && prevData) console.log('  [외국인] 데이터 없음 — 이전 신호 유지');

  // ── 5. 저장 ──
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));

  console.log(`\n[collect-data] 완료!`);
  console.log(`  기관 순매수: ${result.signals.instBuy.length}개`);
  console.log(`  외국인 매집: ${result.signals.foreignBuy.length}개`);
  console.log(`  거래량 급등: ${result.signals.volumeSurge.length}개`);
  console.log(`  강한 수급 후보: ${result.signals.strongDemand.length}개`);
}

main().catch(err => {
  console.error('[collect-data] 치명적 오류:', err);
  process.exit(1);
});
