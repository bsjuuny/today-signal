import { StockSignal, SignalGrade } from '@/types/stock';

interface Props {
  signal: StockSignal;
  rank: number;
}

const GRADE_STYLE: Record<SignalGrade, { badge: string; bar: string }> = {
  A: { badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-700/40', bar: 'bg-emerald-500' },
  B: { badge: 'bg-blue-500/20 text-blue-400 border-blue-700/40', bar: 'bg-blue-500' },
  C: { badge: 'bg-zinc-700/40 text-zinc-400 border-zinc-600/40', bar: 'bg-zinc-600' },
};

const CATEGORY_LABEL: Record<string, string> = {
  INST_BUY: '기관 순매수',
  FOREIGN_BUY: '외국인 매집',
  VOLUME_SURGE: '거래량 급등',
  STRONG_DEMAND: '강한 수급',
};

function scoreBarWidth(score: number) {
  // score 범위: 0 ~ 100
  return `${Math.min(100, Math.max(0, score))}%`;
}

export default function SignalCard({ signal, rank }: Props) {
  const grade = GRADE_STYLE[signal.grade];
  const changePct = signal.stock.changePct;
  const changeColor = changePct > 0 ? 'text-rose-400' : changePct < 0 ? 'text-blue-400' : 'text-zinc-400';
  const changeStr = `${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%`;

  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 flex flex-col gap-3">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-bold text-zinc-600 tabular-nums shrink-0">#{rank}</span>
          <div className="min-w-0">
            <div className="font-bold text-white truncate">{signal.stock.name}</div>
            <div className="text-xs text-zinc-500 font-mono">{signal.stock.code} · {signal.stock.market}</div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-xs font-bold px-2 py-0.5 rounded border ${grade.badge}`}>
            {signal.grade}등급
          </span>
          <span className="text-xs font-bold text-zinc-300 tabular-nums">{signal.score}점</span>
        </div>
      </div>

      {/* 점수 바 */}
      <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${grade.bar}`} style={{ width: scoreBarWidth(signal.score) }} />
      </div>

      {/* 가격 정보 */}
      <div className="flex items-center justify-between">
        <div>
          <span className="font-mono font-bold text-white tabular-nums">
            {signal.stock.price.toLocaleString('ko-KR')}원
          </span>
          <span className={`ml-2 text-sm font-semibold tabular-nums ${changeColor}`}>
            {changeStr}
          </span>
        </div>
        <div className="text-xs text-zinc-600 tabular-nums">
          {(signal.stock.volume / 10000).toFixed(0)}만주
        </div>
      </div>

      {/* 분류 태그 + 이유 */}
      <div className="flex flex-wrap gap-1.5">
        <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
          {CATEGORY_LABEL[signal.category] ?? signal.category}
        </span>
        {signal.reasons.map((r, i) => (
          <span
            key={i}
            className={`text-xs px-2 py-0.5 rounded border ${
              r.direction === 'bullish'
                ? 'bg-emerald-950/30 border-emerald-800/30 text-emerald-400'
                : r.direction === 'bearish'
                  ? 'bg-red-950/30 border-red-800/30 text-red-400'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400'
            }`}
          >
            {r.label} {r.score > 0 ? `+${r.score}` : r.score}
          </span>
        ))}
      </div>
    </div>
  );
}
