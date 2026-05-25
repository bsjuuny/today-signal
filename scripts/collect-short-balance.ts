/**
 * 공매도 잔고 감소 감지 스크립트
 * 실행: npm run short:balance (장마감 후 18:30 KST 전후)
 *
 * 흐름:
 *   1. today_signal.json에서 후보 종목 추출
 *   2. 종목별 공매도 잔고 5일 히스토리 조회 (KIS API)
 *   3. 연속 감소 3일+ && 총 감소율 5%+ 필터
 *   4. short_balance.json 저장 (당일 날짜 태그)
 *   5. kis-trader/data/today/에 복사
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getShortBalanceHistory, sleep, getLastTradingDate } from '../lib/kis-api';

const SIGNAL_PATH  = path.resolve(process.cwd(), 'public', 'data', 'today_signal.json');
const OUTPUT_PATH  = path.resolve(process.cwd(), 'public', 'data', 'short_balance.json');
const KIS_COPY     = path.resolve(process.cwd(), '..', 'kis-trader', 'data', 'today', 'short_balance.json');

const MIN_CONSEC_DAYS   = 1;    // 연속 감소 최소 일수 (완화)
const MIN_DECLINE_PCT   = 1.0;  // 총 감소율 최소 (%) (완화)
const MIN_BALANCE_RATIO = 0.1;  // 공매도 잔고 비율 최소 (%) (완화)

interface ShortInfo {
  code: string;
  name: string;
  consecDays: number;     // 연속 감소 일수
  totalDeclinePct: number; // 기준일 → 최근일 총 감소율 (%)
  latestRatio: number;    // 최신 공매도 잔고 비율 (유동주식 대비 %)
  latestQty: number;      // 최신 공매도 잔고 수량
}

function loadCandidateCodes(): { code: string; name: string }[] {
  try {
    if (!fs.existsSync(SIGNAL_PATH)) {
      console.warn(`[short-balance] SIGNAL_PATH 미존재: ${SIGNAL_PATH}`);
      return [];
    }
    const data = JSON.parse(fs.readFileSync(SIGNAL_PATH, 'utf-8'));
    const signals = data?.signals ?? {};
    const seen = new Set<string>();
    const result: { code: string; name: string }[] = [];
    for (const key of ['instBuy', 'foreignBuy', 'strongDemand', 'volumeSurge']) {
      for (const sig of (signals[key] ?? [])) {
        const code: string = (sig?.stock?.code || sig?.code || '').toString();
        const name: string = (sig?.stock?.name || sig?.name || '').toString();
        if (code && !seen.has(code)) {
          seen.add(code);
          result.push({ code, name });
        }
      }
    }
    console.log(`[short-balance] 후보 ${result.length}개 로드 성공 (${SIGNAL_PATH})`);
    return result;
  } catch (e) {
    console.warn('[short-balance] today_signal.json 로드 실패:', (e as Error).message);
    return [];
  }
}

function calcShortTrend(history: { date: string; qty: number; ratio: number }[]): {
  consecDays: number;
  totalDeclinePct: number;
} {
  // history[0] = 가장 최근, history[n] = 오래된 순
  if (history.length < 2) return { consecDays: 0, totalDeclinePct: 0 };

  // 연속 감소 일수 (최신 → 과거 방향으로 qty 비교)
  let consecDays = 0;
  for (let i = 0; i < history.length - 1; i++) {
    if (history[i].qty < history[i + 1].qty) {
      consecDays++;
    } else {
      break;
    }
  }

  // 총 감소율: (가장 오래된 값 - 최신 값) / 가장 오래된 값 * 100
  const oldest = history[history.length - 1].qty;
  const latest = history[0].qty;
  const totalDeclinePct = oldest > 0 ? (oldest - latest) / oldest * 100 : 0;

  return { consecDays, totalDeclinePct };
}



async function main() {
  console.log(`[short-balance] 시작: ${new Date().toLocaleString('ko-KR')}`);

  const candidates = loadCandidateCodes();
  if (candidates.length === 0) {
    console.warn('[short-balance] 후보 없음 — 종료');
    return;
  }

  const today = getLastTradingDate();
  const results: ShortInfo[] = [];
  const spikes: { code: string; name: string; pct: number }[] = [];

  for (const { code, name } of candidates) {
    try {
      const history = await getShortBalanceHistory(code, 7); // 7거래일 조회 → 최대 5일 연속 계산
      await sleep(200);

      if (history.length < 2) {
        console.log(`  [${code}] ${name}: 데이터 부족 (${history.length}일)`);
        continue;
      }

      const { consecDays, totalDeclinePct } = calcShortTrend(history);
      const latestRatio = history[0]?.ratio ?? 0;
      const latestQty   = history[0]?.qty ?? 0;

      // 급증(Spike) 감지: 전일 대비 20% 이상 증가 시
      if (history.length >= 2) {
        const prevQty = history[1].qty;
        if (prevQty > 0) {
          const spikePct = (latestQty - prevQty) / prevQty * 100;
          if (spikePct >= 20.0 && latestRatio >= 0.5) {
            spikes.push({ code, name, pct: spikePct });
          }
        }
      }

      if (consecDays < MIN_CONSEC_DAYS || totalDeclinePct < MIN_DECLINE_PCT || latestRatio < MIN_BALANCE_RATIO) {
        continue;
      }

      results.push({ code, name, consecDays, totalDeclinePct, latestRatio, latestQty });
      console.log(`  [${code}] ${name}: ${consecDays}일 연속 감소 | 총 -${totalDeclinePct.toFixed(1)}% | 잔고비율 ${latestRatio.toFixed(2)}%`);
    } catch (e) {
      console.warn(`  [${code}] ${name}: 조회 실패 — ${(e as Error).message}`);
    }
  }

  // 감소율 내림차순 정렬
  results.sort((a, b) => b.totalDeclinePct - a.totalDeclinePct);

  const output = {
    date: today,
    generatedAt: new Date().toISOString(),
    count: results.length,
    items: results,
  };

  // 저장
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`[short-balance] 저장 완료: ${results.length}개 → ${OUTPUT_PATH}`);

  // kis-trader로 결과 자동 전파 (자동화 고도화)
  try {
    const KIS_DATA_DEST = path.resolve(process.cwd(), '..', 'kis-trader', 'data', 'today', 'short_balance.json');
    fs.mkdirSync(path.dirname(KIS_DATA_DEST), { recursive: true });
    fs.copyFileSync(OUTPUT_PATH, KIS_DATA_DEST);
    console.log(`[short-balance] kis-trader 자동 동기화 완료: ${KIS_DATA_DEST}`);
  } catch (e) {
    console.warn('[short-balance] kis-trader 동기화 실패:', (e as Error).message);
  }

  // 텔레그램 발송 (급증 종목)
  if (spikes.length > 0) {
    spikes.sort((a, b) => b.pct - a.pct);
    const spikeMsg = `⚠️ <b>[전체 관심종목] 공매도 급증 경고</b>\n\n` + 
                     spikes.slice(0, 10).map(s => `▪️ <b>${s.name}</b>: +${s.pct.toFixed(1)}% 급증`).join('\n') +
                     `\n\n조심하세요! 공매도 세력의 집중 타겟이 될 수 있습니다.`;
    try {
      const notifyScript = 'C:/github/antigravity-bot/scripts/notify.mjs';
      execSync(`node "${notifyScript}" --prefix "🚨 [Short Balance]" --html --force`, {
        input: spikeMsg,
        encoding: 'utf-8',
        windowsHide: true,
      });
      console.log(`[short-balance] 급증 알림 발송 완료 (${spikes.length}개 종목)`);
    } catch (err) {
      console.warn('[short-balance] 알림 발송 실패:', (err as Error).message);
    }
  }

  console.log(`[short-balance] 완료: ${new Date().toLocaleString('ko-KR')}`);
}

main().catch(err => {
  console.error('[short-balance] 치명적 오류:', err);
  process.exit(1);
});
