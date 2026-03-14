import { StockSignal } from '@/types/stock';
import SignalCard from './SignalCard';

interface Props {
  signals: StockSignal[];
  emptyMessage?: string;
}

export default function SignalList({ signals, emptyMessage = '오늘은 추천 종목이 없습니다' }: Props) {
  if (signals.length === 0) {
    return (
      <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-10 text-center">
        <p className="text-2xl mb-3">📭</p>
        <p className="text-zinc-400 text-sm font-medium">{emptyMessage}</p>
        <p className="text-zinc-600 text-xs mt-2 leading-relaxed">
          조건을 충족하는 종목이 없거나<br />시장 상황에 따라 신호가 억제되었습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {signals.map((signal, i) => (
        <SignalCard key={signal.stock.code} signal={signal} rank={i + 1} />
      ))}
    </div>
  );
}
