import { useState } from 'react';
import { StockSignal, SignalGrade } from '@/types/stock';
import ProfitCalculator from './ProfitCalculator';
import { Calculator, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  signal: StockSignal;
  rank: number;
}

const GRADE_STYLE: Record<SignalGrade, { badge: string; bar: string; glow: string }> = {
  A: { badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-700/40', bar: 'bg-emerald-500', glow: 'shadow-emerald-500/10' },
  B: { badge: 'bg-blue-500/15 text-blue-400 border-blue-700/40', bar: 'bg-blue-500', glow: 'shadow-blue-500/10' },
  C: { badge: 'bg-zinc-700/40 text-zinc-400 border-zinc-600/40', bar: 'bg-zinc-600', glow: '' },
};

const CATEGORY_LABEL: Record<string, string> = {
  INST_BUY: '기관 순매수',
  FOREIGN_BUY: '외국인 매집',
  VOLUME_SURGE: '거래량 급등',
  STRONG_DEMAND: '강한 수급',
};

function scoreBarWidth(score: number) {
  return `${Math.min(100, Math.max(0, score))}%`;
}

export default function SignalCard({ signal, rank }: Props) {
  const [showCalculator, setShowCalculator] = useState(false);
  const grade = GRADE_STYLE[signal.grade];
  const changePct = signal.stock.changePct;
  const changeColor = changePct > 0 ? 'text-rose-400' : changePct < 0 ? 'text-blue-400' : 'text-zinc-400';
  const changeStr = `${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%`;

  return (
    <div className={`rounded-2xl bg-zinc-900 border border-zinc-800 flex flex-col overflow-hidden shadow-lg ${grade.glow}`}>
      <div className="p-5 flex flex-col gap-3.5">
        {/* 헤더 */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs font-black text-zinc-700 tabular-nums shrink-0 w-5 text-right">#{rank}</span>
            <div className="min-w-0">
              <div className="font-black text-base text-white leading-tight break-keep">{signal.stock.name}</div>
              <div className="text-xs text-zinc-600 font-mono mt-0.5">{signal.stock.code} · {signal.stock.market}</div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span className={`text-xs font-black px-2.5 py-1 rounded-lg border ${grade.badge}`}>
              {signal.grade}등급
            </span>
            <span className="text-xs font-bold text-zinc-500 tabular-nums">{signal.score}점</span>
          </div>
        </div>

        {/* 점수 바 */}
        <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${grade.bar}`} style={{ width: scoreBarWidth(signal.score) }} />
        </div>

        {/* 가격 정보 */}
        <div className="flex items-center justify-between py-0.5">
          <div className="flex items-baseline gap-2">
            <span className="font-mono font-black text-lg text-white tabular-nums leading-none">
              {signal.stock.price.toLocaleString('ko-KR')}원
            </span>
            <span className={`text-sm font-bold tabular-nums ${changeColor}`}>
              {changeStr}
            </span>
          </div>
          <div className="text-xs text-zinc-600 tabular-nums">
            {(signal.stock.volume / 10000).toFixed(0)}만주
          </div>
        </div>

        {/* 분류 태그 + 이유 */}
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs px-2.5 py-1 rounded-lg bg-zinc-800 text-zinc-400 font-semibold">
            {CATEGORY_LABEL[signal.category] ?? signal.category}
          </span>
          {signal.reasons.map((r, i) => (
            <span
              key={i}
              className={`text-xs px-2.5 py-1 rounded-lg border font-semibold ${
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

        {/* 푸터 액션 */}
        <div className="pt-2.5 border-t border-zinc-800/60 flex justify-end">
          <button
            onClick={() => setShowCalculator(!showCalculator)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
              showCalculator
                ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
            }`}
          >
            <Calculator size={13} />
            수익 계산기
            {showCalculator ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* 확장 영역: 계산기 */}
      {showCalculator && (
        <div className="p-5 bg-black/60 border-t border-zinc-800">
          <ProfitCalculator
            currentPrice={signal.stock.price}
            stockName={signal.stock.name}
          />
        </div>
      )}
    </div>
  );
}
