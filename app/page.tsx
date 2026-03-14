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
      <div className="mx-auto max-w-md px-4 py-6">
        <div className="mb-5">
          <h1 className="text-xl font-black text-white tracking-tight">오늘의 투자 신호</h1>
          <p className="text-xs text-zinc-500 mt-0.5">기관·외국인·거래량 기반 국내 주식 수급 분석</p>
        </div>

        {data ? (
          <SignalView data={data} />
        ) : (
          <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-10 text-center">
            <p className="text-zinc-400 text-sm font-medium">데이터 준비 중</p>
            <p className="text-zinc-600 text-xs mt-2">장 마감 후 16:10 이후 데이터가 업데이트됩니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}
