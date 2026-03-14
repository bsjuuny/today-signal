'use client';

export type TabKey = 'instBuy' | 'foreignBuy' | 'volumeSurge' | 'strongDemand';

const TABS: { key: TabKey; label: string; emoji: string }[] = [
  { key: 'strongDemand', label: '강한 수급', emoji: '🔥' },
  { key: 'instBuy', label: '기관', emoji: '🏦' },
  { key: 'foreignBuy', label: '외국인', emoji: '🌐' },
  { key: 'volumeSurge', label: '거래량', emoji: '📊' },
];

interface Props {
  active: TabKey;
  onChange: (tab: TabKey) => void;
  counts: Record<TabKey, number>;
}

export default function TabBar({ active, onChange, counts }: Props) {
  return (
    <div className="flex gap-1 bg-zinc-900 rounded-xl p-1 border border-zinc-800">
      {TABS.map(({ key, label, emoji }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
            active === key
              ? 'bg-zinc-700 text-white'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <span className="text-base leading-none">{emoji}</span>
          <span>{label}</span>
          {counts[key] > 0 && (
            <span className={`text-[10px] tabular-nums ${active === key ? 'text-zinc-400' : 'text-zinc-600'}`}>
              {counts[key]}개
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
