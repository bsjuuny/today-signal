'use client';

import { classifiedSignals } from '@/lib/instrument';
import { isMarketUsable } from '@/lib/market-data';
import { useState } from 'react';
import { TodaySignalData } from '@/types/stock';
import TabBar, { TabKey } from './TabBar';
import SignalList from './SignalList';
import MarketBanner from './MarketBanner';
import Disclaimer from './Disclaimer';

interface Props {
  data: TodaySignalData;
}

const EMPTY_MSG: Record<TabKey, string> = {
  strongDemand: '오늘은 강한 수급 종목이 없습니다',
  instBuy: '오늘은 기관 순매수 추천 종목이 없습니다',
  foreignBuy: '오늘은 외국인 매집 추천 종목이 없습니다',
  volumeSurge: '오늘은 거래량 급등 추천 종목이 없습니다',
};

export default function SignalView({ data }: Props) {
  const [listingMarket, setListingMarket] = useState<'ALL' | 'KOSPI' | 'KOSDAQ'>('ALL');
  const [tab, setTab] = useState<TabKey>('strongDemand');

  const { market, date } = data;
  const signals = isMarketUsable(market) && data.status === 'completed' ? classifiedSignals(data, listingMarket)
    : { instBuy: [], foreignBuy: [], volumeSurge: [], strongDemand: [], momentum: [] };
  const counts: Record<TabKey, number> = {
    strongDemand: signals.strongDemand.length,
    instBuy: signals.instBuy.length,
    foreignBuy: signals.foreignBuy.length,
    volumeSurge: signals.volumeSurge.length,
  };

  const active = (
    tab === 'strongDemand' ? signals.strongDemand
    : tab === 'instBuy' ? signals.instBuy
    : tab === 'foreignBuy' ? signals.foreignBuy
    : signals.volumeSurge
  ).slice(0, 15);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        <div className="lg:col-span-1 flex flex-col gap-6">
          <MarketBanner market={market} date={date} />
          <div className="hidden lg:block">
            <Disclaimer />
          </div>
        </div>
        <div className="lg:col-span-2 xl:col-span-3 flex flex-col gap-6">
          <div className="flex gap-3 items-center text-sm text-zinc-300">
            <span>기업 주식 · ETF/ETN 제외</span>
            <label>상장시장 <select aria-label="상장시장" value={listingMarket} onChange={e => setListingMarket(e.target.value as typeof listingMarket)} className="bg-zinc-900 p-2 rounded">
              <option value="ALL">전체</option><option value="KOSPI">KOSPI</option><option value="KOSDAQ">KOSDAQ</option>
            </select></label>
          </div>
          <p className="text-xs text-zinc-500">공식 분류가 확인된 기업 주식만 표시합니다. 미확인 과거 신호는 표시하지 않습니다.</p>
          <TabBar active={tab} onChange={setTab} counts={counts} />
          <SignalList signals={active} emptyMessage={EMPTY_MSG[tab]} />
        </div>
      </div>
      <div className="lg:hidden">
        <Disclaimer />
      </div>
      <p className="text-center text-xs text-zinc-700 pb-4 tabular-nums">
        {new Date(data.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} 업데이트
      </p>
    </div>
  );
}
