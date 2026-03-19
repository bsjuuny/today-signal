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

function indexBg(v: number) {
  if (v > 0) return 'bg-rose-500/10';
  if (v < 0) return 'bg-blue-500/10';
  return 'bg-zinc-800/50';
}

export default function MarketBanner({ market, date }: Props) {
  const dateStr = `${date.slice(0, 4)}.${date.slice(4, 6)}.${date.slice(6, 8)}`;

  const isSuppressed = market.kospiChange <= -1.5 || market.kosdaqChange <= -2.0;

  return (
    <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 flex flex-col gap-3">
      {/* 날짜 + 상태 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-500">{dateStr}</span>
          {market.isIntraday ? (
            <span className="flex items-center gap-1 text-xs font-bold text-emerald-400">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              장중
            </span>
          ) : (
            <span className="text-xs text-zinc-700 font-medium">장 마감</span>
          )}
        </div>
        <span className="text-xs text-zinc-600 tabular-nums">
          거래대금 <span className="text-zinc-500 font-semibold">{market.kospiVolume.toLocaleString()}억</span>
        </span>
      </div>

      {/* 지수 */}
      <div className="grid grid-cols-2 gap-2">
        <div className={`rounded-xl p-3 ${indexBg(market.kospiChange)}`}>
          <div className="text-xs text-zinc-500 font-medium mb-1">코스피</div>
          <div className={`text-xl font-black tabular-nums leading-none ${indexColor(market.kospiChange)}`}>
            {pct(market.kospiChange)}
          </div>
        </div>
        <div className={`rounded-xl p-3 ${indexBg(market.kosdaqChange)}`}>
          <div className="text-xs text-zinc-500 font-medium mb-1">코스닥</div>
          <div className={`text-xl font-black tabular-nums leading-none ${indexColor(market.kosdaqChange)}`}>
            {pct(market.kosdaqChange)}
          </div>
        </div>
      </div>

      {isSuppressed && (
        <div className="rounded-xl bg-red-950/50 border border-red-800/40 px-3 py-2.5">
          <p className="text-xs text-red-400 font-bold text-center">
            ⚠ 시장 급락 — 신호 신뢰도가 낮습니다. 관망을 권장합니다.
          </p>
        </div>
      )}
    </div>
  );
}
