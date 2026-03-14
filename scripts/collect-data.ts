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
  return {
    code,
    instNetBuy,
    instNetBuyAmt: 0, // 금액은 별도 조회 필요 시 추가
    instConsecutiveDays: instConsec,
    foreignNetBuy,
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

  console.log('[collect-data] 데이터 수집 시작...');

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
    kospiVolume: Math.round(kospi.volume / 100000000),
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

  // 기관 순매수 처리
  console.log('\n  [스코어링] 기관 순매수...');
  const instSignals: StockSignal[] = [];
  for (const item of instList) {
    const { stock, supply } = await processItem(item.code, item.name, item.price, item.changePct, item.volume, item.netBuyQty, 0);
    if (!stock || !supply) continue;
    const signal = scoreInstBuy(stock, supply, market);
    if (signal) {
      instSignals.push(signal);
      console.log(`    ✓ ${stock.name} (${stock.code}) 점수: ${signal.score}`);
    }
  }

  // 외국인 매집 처리
  console.log('\n  [스코어링] 외국인 매집...');
  const foreignSignals: StockSignal[] = [];
  for (const item of foreignList) {
    const { stock, supply } = await processItem(item.code, item.name, item.price, item.changePct, item.volume, 0, item.netBuyQty);
    if (!stock || !supply) continue;
    const signal = scoreForeignBuy(stock, supply, market);
    if (signal) {
      foreignSignals.push(signal);
      console.log(`    ✓ ${stock.name} (${stock.code}) 점수: ${signal.score}`);
    }
  }

  // 거래량 급등 처리
  console.log('\n  [스코어링] 거래량 급등...');
  const volSignals: StockSignal[] = [];
  for (const item of volList) {
    const { stock, supply } = await processItem(item.code, item.name, item.price, item.changePct, item.volume, 0, 0);
    if (!stock || !supply) continue;
    const signal = scoreVolumeSurge(stock, supply, market);
    if (signal) {
      volSignals.push(signal);
      console.log(`    ✓ ${stock.name} (${stock.code}) 점수: ${signal.score}`);
    }
  }

  // 강한 수급 후보 (전체 후보에서)
  console.log('\n  [스코어링] 강한 수급 후보...');
  const allCandidates = [
    ...instList.map(i => ({ code: i.code, name: i.name, price: i.price, changePct: i.changePct, volume: i.volume, instBuy: i.netBuyQty, foreignBuy: 0 })),
    ...foreignList.map(i => ({ code: i.code, name: i.name, price: i.price, changePct: i.changePct, volume: i.volume, instBuy: 0, foreignBuy: i.netBuyQty })),
  ];
  const strongSignals: StockSignal[] = [];
  for (const item of allCandidates) {
    const { stock, supply } = await processItem(item.code, item.name, item.price, item.changePct, item.volume, item.instBuy, item.foreignBuy);
    if (!stock || !supply) continue;
    const signal = scoreStrongDemand(stock, supply, market);
    if (signal) {
      strongSignals.push(signal);
      console.log(`    ✓ ${stock.name} (${stock.code}) 점수: ${signal.score}`);
    }
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
