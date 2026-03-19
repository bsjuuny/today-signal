import fs from 'fs';
import path from 'path';
import { TodaySignalData } from '@/types/stock';
import SignalView from './components/SignalView';

const DATA_PATH = path.join(process.cwd(), 'public', 'data', 'today_signal.json');

function loadData(): TodaySignalData | null {
  try {
    if (!fs.existsSync(DATA_PATH)) return null;
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8')) as TodaySignalData;
  } catch {
    return null;
  }
}

export default function Home() {
  const data = loadData();

  return (
    <div className="min-h-screen bg-black">
      {/* Top accent bar */}
      <div className="h-0.5 bg-gradient-to-r from-rose-600 via-rose-500 to-orange-500" />

      <div className="mx-auto max-w-[1600px] px-4 py-6">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-black text-white tracking-tight leading-tight">오늘의 투자 신호</h1>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">기관·외국인·거래량 기반 국내 주식 수급 분석</p>
          </div>
          {data && (
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border ${
              data.market.isIntraday
                ? 'bg-emerald-950/60 border-emerald-700/50 text-emerald-400'
                : 'bg-zinc-900 border-zinc-700 text-zinc-500'
            }`}>
              {data.market.isIntraday && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
              {data.market.isIntraday ? 'LIVE' : '장 마감'}
            </div>
          )}
        </div>

        {data ? (
          <SignalView data={data} />
        ) : (
          <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">📊</span>
            </div>
            <p className="text-zinc-300 text-sm font-bold mb-1">데이터 준비 중</p>
            <p className="text-zinc-600 text-xs leading-relaxed">장 마감 후 16:10 이후<br />데이터가 업데이트됩니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}
