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
import { writeJsonAtomic } from '../lib/safe-io';

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

/** 후보 종목. 신호 파일을 못 읽거나 형식이 이상하면 null(입력 장애) — 정상 0건([])과 구분한다. */
function loadCandidateCodes(): { code: string; name: string }[] | null {
  try {
    if (!fs.existsSync(SIGNAL_PATH)) {
      console.warn(`[short-balance] SIGNAL_PATH 미존재: ${SIGNAL_PATH}`);
      return null;
    }
    const data = JSON.parse(fs.readFileSync(SIGNAL_PATH, 'utf-8'));
    const signals = data?.signals;
    const keys = ['instBuy', 'foreignBuy', 'strongDemand', 'volumeSurge'];
    // 수집 실패(status≠completed)나 분류 누락은 입력 장애다. 하락장 억제는 completed + 빈 배열이라 정상 0건으로 처리된다.
    if (data?.status !== 'completed' || !signals || typeof signals !== 'object'
      || keys.some(k => !Array.isArray(signals[k]))) {
      console.warn(`[short-balance] today_signal.json 사용 불가 (status=${data?.status})`);
      return null;
    }
    const seen = new Set<string>();
    const result: { code: string; name: string }[] = [];
    for (const key of keys) {
      for (const sig of signals[key]) {
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
    return null;
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



/** 결과를 원자적으로 저장하고 kis-trader 로도 복사한다. */
function save(output: { date: string; generatedAt: string; count: number; items: ShortInfo[] }) {
  writeJsonAtomic(OUTPUT_PATH, output);
  console.log(`[short-balance] 저장 완료: ${output.count}개 → ${OUTPUT_PATH}`);
  try {
    writeJsonAtomic(KIS_COPY, output);
    console.log(`[short-balance] kis-trader 자동 동기화 완료: ${KIS_COPY}`);
  } catch (e) {
    console.warn('[short-balance] kis-trader 동기화 실패:', (e as Error).message);
  }
}

async function main() {
  console.log(`[short-balance] 시작: ${new Date().toLocaleString('ko-KR')}`);

  const today = getLastTradingDate();
  const candidates = loadCandidateCodes();
  if (candidates === null) {
    // 입력 장애는 '후보 0건'이 아니다. 기존 파일을 덮지 않고 실패로 끝낸다
    // (다음 신호 수집은 기준일 신선도 확인으로 오래된 자료를 거른다).
    throw new Error('today_signal.json 을 읽을 수 없어 공매도 잔고 수집 중단');
  }
  if (candidates.length === 0) {
    // 후보가 없어도 오늘 날짜의 빈 결과를 남긴다 — 예전엔 그냥 끝나서 며칠 지난 자료가
    // 그대로 남아 다음 신호 수집이 오래된 공매도 가산점을 줬다(2026-11-26).
    console.warn('[short-balance] 후보 없음 — 빈 결과 저장');
    save({ date: today, generatedAt: new Date().toISOString(), count: 0, items: [] });
    return;
  }

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

  save(output);

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
