import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import fs from 'fs';
import path from 'path';
import { getStockQuote, sleep, getLastTradingDate } from '../lib/kis-api';
import { TodaySignalData, StockSignal } from '../types/stock';

const HISTORY_DIR = path.join(process.cwd(), 'public', 'data', 'history');

/** 
 * 어제(이전 거래일)의 신호 데이터를 찾아옵니다.
 */
function getPreviousSignalFile(): { path: string; date: string } | null {
  if (!fs.existsSync(HISTORY_DIR)) return null;
  const files = fs.readdirSync(HISTORY_DIR)
    .filter(f => f.startsWith('signal_') && f.endsWith('.json'))
    .sort()
    .reverse();
    
  if (files.length === 0) return null;
  
  const today = getLastTradingDate();
  // 오늘 생성된 파일은 검증 대상이 아니므로 제외 (어제 신호를 오늘 장마감에 검증)
  const prevFiles = files.filter(f => !f.includes(today));
  
  if (prevFiles.length === 0) return null;
  
  // 가장 최근(어제) 파일 선택
  const targetFile = prevFiles[0];
  const dateMatch = targetFile.match(/signal_(\d{8})\.json/);
  
  return {
    path: path.join(HISTORY_DIR, targetFile),
    date: dateMatch ? dateMatch[1] : 'Unknown'
  };
}

let reportLines: string[] = [];

function log(msg: string) {
  console.log(msg);
  // Telegram 메시지는 간결하게 유지 (구분선 단순화)
  const cleanMsg = msg.replace(/========================================================/g, '━━━━━━━━━━━━━━━━━━━━━━━━')
                      .replace(/--------------------------------------------------------/g, '────────────────────────');
  reportLines.push(cleanMsg);
}

async function sendTelegram(message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('⚠️ 텔레그램 토큰 또는 Chat ID가 없어 전송을 생략합니다.');
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      })
    });
    if (!res.ok) throw new Error(await res.text());
    console.log('📬 텔레그램 리포트 전송 성공!');
  } catch (err) {
    console.error('❌ 텔레그램 전송 실패:', (err as Error).message);
  }
}

async function verifyCategory(name: string, signals: StockSignal[]) {
  if (!signals || signals.length === 0) return;
  
  log(`\n========================================================`);
  log(` 📊 [${name}] 타점 성과 검증 (TOP 5)`);
  log(`========================================================`);
  
  const topSignals = signals.slice(0, 5); // 상위 5개만 검증
  let totalMaxProfit = 0;
  let totalCloseProfit = 0;
  let winCount = 0;

  for (const sig of topSignals) {
    try {
      const prevPrice = sig.stock.price;
      const quote = await getStockQuote(sig.stock.code);
      await sleep(150);
      
      const maxProfit = ((quote.high - prevPrice) / prevPrice) * 100;
      const closeProfit = ((quote.price - prevPrice) / prevPrice) * 100;
      
      totalMaxProfit += maxProfit;
      totalCloseProfit += closeProfit;
      if (maxProfit >= 3) winCount++; // 3% 이상 상승하면 승리(Win)로 간주
      
      const isWin = maxProfit >= 3 ? '✅' : (maxProfit > 0 ? '⚠️' : '❌');
      log(`<b>${isWin} ${sig.stock.name}</b> (${sig.stock.code}) | 전일: ${prevPrice.toLocaleString()}원`);
      log(`    → 당일 고가: 최고 <b>${maxProfit > 0 ? '+' : ''}${maxProfit.toFixed(2)}%</b> (${quote.high.toLocaleString()}원)`);
      log(`    → 당일 종가: 종가 <b>${closeProfit > 0 ? '+' : ''}${closeProfit.toFixed(2)}%</b> (${quote.price.toLocaleString()}원)`);
      
    } catch (e) {
      log(`    ❌ ${sig.stock.name} 데이터 조회 실패`);
    }
  }
  
  log(`--------------------------------------------------------`);
  log(` 💡 섹터 평균: 최고 <b>+${(totalMaxProfit / topSignals.length).toFixed(2)}%</b> | 승률: <b>${(winCount / topSignals.length * 100).toFixed(0)}%</b> (3% 기준)`);
}

async function main() {
  console.log(`[성과 검증] 어제 추출된 종목들의 당일 수익률을 확인합니다...`);
  
  const prevFile = getPreviousSignalFile();
  if (!prevFile) {
    const msg = '검증할 이전 거래일의 신호 데이터(history/signal_*.json)를 찾을 수 없습니다.\n💡 팁: 오늘 오후 4시에 데이터를 수집하면 내일부터 검증이 가능합니다.';
    console.error(msg);
    await sendTelegram(`⚠️ <b>성과 검증 실패</b>\n\n${msg}`);
    return;
  }
  
  log(`📍 <b>기준 데이터:</b> ${prevFile.date} 장마감 신호`);
  log(`📍 <b>검증 시점:</b> ${getLastTradingDate()} (당일 고가/종가 기준)`);
  
  const data: TodaySignalData = JSON.parse(fs.readFileSync(prevFile.path, 'utf-8'));
  
  await verifyCategory('쌍끌이 & 강한수급', data.signals.strongDemand);
  await verifyCategory('단타 모멘텀', data.signals.momentum);
  await verifyCategory('기관 순매수', data.signals.instBuy);
  await verifyCategory('거래량 급등', data.signals.volumeSurge);
  
  log(`\n🎉 검증 완료`);
  
  // 텔레그램 메시지는 HTML 태그가 포함되어 있으므로 통째로 발송
  await sendTelegram(`🎯 <b>당일 타점 성과 검증 리포트</b>\n${reportLines.join('\n')}`);
}

main().catch(console.error);
