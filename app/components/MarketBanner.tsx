import { MarketContext } from '@/types/stock';

interface Props {
  market: MarketContext;
  date: string;
}

function pct(v: number) {
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function indexColor(v: number) {
  if (v > 0) return 'text-rose-400';
  if (v < 0) return 'text-blue-400';
  return 'text-zinc-400';
}

export default function MarketBanner({ market, date }: Props) {
  const dateStr = `${date.slice(0, 4)}.${date.slice(4, 6)}.${date.slice(6, 8)}`;

  const isSuppressed = market.kospiChange <= -1.5 || market.kosdaqChange <= -2.0;

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500 font-medium">{dateStr} 장 마감</span>
        <span className="text-xs text-zinc-600">
          거래대금 {market.kospiVolume.toLocaleString()}억
        </span>
      </div>
      <div className="flex gap-4">
        <div className="flex-1 text-center">
          <div className="text-xs text-zinc-500 mb-1">코스피</div>
          <div className={`text-lg font-bold tabular-nums ${indexColor(market.kospiChange)}`}>
            {pct(market.kospiChange)}
          </div>
        </div>
        <div className="w-px bg-zinc-800" />
        <div className="flex-1 text-center">
          <div className="text-xs text-zinc-500 mb-1">코스닥</div>
          <div className={`text-lg font-bold tabular-nums ${indexColor(market.kosdaqChange)}`}>
            {pct(market.kosdaqChange)}
          </div>
        </div>
      </div>
      {isSuppressed && (
        <div className="rounded-lg bg-red-950/50 border border-red-800/40 px-3 py-2">
          <p className="text-xs text-red-400 font-semibold text-center">
            ⚠ 시장 급락 — 신호 신뢰도가 낮습니다. 관망을 권장합니다.
          </p>
        </div>
      )}
    </div>
  );
}
