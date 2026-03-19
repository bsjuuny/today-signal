'use client';

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
  const [tab, setTab] = useState<TabKey>('strongDemand');

  const { signals, market, date } = data;
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
  ).slice(0, 10);

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
