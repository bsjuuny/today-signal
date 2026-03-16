"use client";

import React, { useState, useMemo } from 'react';
import { Calculator, Info, TrendingUp, AlertCircle } from 'lucide-react';

interface ProfitCalculatorProps {
  currentPrice: number;
  stockName?: string;
  defaultAmount?: number;
}

/**
 * 실전 수익 계산기 (수수료/세금 고려)
 */
export default function ProfitCalculator({ 
  currentPrice, 
  stockName, 
  defaultAmount = 1000000 
}: ProfitCalculatorProps) {
  const [buyAmount, setBuyAmount] = useState(defaultAmount);
  const [targetPct, setTargetPct] = useState(3); // 목표 수익률 3%

  // 한국 주식 매매 비용 상수 (일반적인 온라인 거래 기준)
  const BUY_FEE_RATE = 0.00015;  // 매수 수수료 (0.015%)
  const SELL_FEE_RATE = 0.00015; // 매도 수수료 (0.015%)
  const SELL_TAX_RATE = 0.0018;  // 증권거래세+농특세 (0.18%)

  const calculations = useMemo(() => {
    const quantity = Math.floor(buyAmount / currentPrice);
    const actualBuyPrice = quantity * currentPrice;
    const buyFee = actualBuyPrice * BUY_FEE_RATE;
    const totalCost = actualBuyPrice + buyFee;

    // 목표가 계산
    const targetPrice = currentPrice * (1 + targetPct / 100);
    const sellAmount = quantity * targetPrice;
    const sellFee = sellAmount * SELL_FEE_RATE;
    const sellTax = sellAmount * SELL_TAX_RATE;
    
    const totalRevenue = sellAmount - sellFee - sellTax;
    const pureProfit = totalRevenue - totalCost;
    const realProfitPct = (pureProfit / totalCost) * 100;

    // 손익분기점 (BEP) 계산 (수수료와 세금을 극복하는 지점)
    // BuyCost = (Q * BP) + (Q * BP * BuyFee)
    // SellRevenue = (Q * SP) - (Q * SP * SellFee) - (Q * SP * SellTax)
    // SP = BP * (1 + BuyFee) / (1 - SellFee - SellTax)
    const bepPrice = currentPrice * (1 + BUY_FEE_RATE) / (1 - SELL_FEE_RATE - SELL_TAX_RATE);
    const bepPct = ((bepPrice / currentPrice) - 1) * 100;

    return {
      quantity,
      actualBuyPrice,
      totalCost,
      pureProfit,
      realProfitPct,
      bepPrice,
      bepPct,
      targetPrice
    };
  }, [buyAmount, currentPrice, targetPct]);

  return (
    <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800 p-5 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Calculator size={16} className="text-rose-500" />
          실전 수익 시뮬레이터
        </h3>
        <span className="text-[10px] font-medium text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">
          코스피/코스닥 기준
        </span>
      </div>

      <div className="space-y-4">
        {/* 투자 금액 입력 */}
        <div>
          <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2 block">
            투자 금액 (KRW)
          </label>
          <input
            type="number"
            value={buyAmount}
            onChange={(e) => setBuyAmount(Number(e.target.value))}
            className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-white font-black text-lg focus:outline-none focus:border-rose-500/50 transition-colors"
          />
          <div className="flex gap-1.5 mt-2">
            {[1000000, 3000000, 5000000, 10000000].map((amt) => (
              <button
                key={amt}
                onClick={() => setBuyAmount(amt)}
                className="flex-1 py-1.5 rounded-lg bg-zinc-800 text-[10px] font-bold text-zinc-400 hover:bg-zinc-700 transition-colors"
              >
                {amt / 10000}만
              </button>
            ))}
          </div>
        </div>

        {/* 수량 및 평단가 정보 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-black/40 rounded-xl p-3 border border-zinc-800/50">
            <p className="text-[10px] text-zinc-500 font-bold mb-1">매수 가능 수량</p>
            <p className="text-sm font-black text-white">{calculations.quantity.toLocaleString()}주</p>
          </div>
          <div className="bg-black/40 rounded-xl p-3 border border-zinc-800/50">
            <p className="text-[10px] text-zinc-500 font-bold mb-1">총 매수 비용</p>
            <p className="text-sm font-black text-white">₩{Math.round(calculations.totalCost).toLocaleString()}</p>
          </div>
        </div>

        {/* 손익분기점 (BEP) 섹션 */}
        <div className="bg-rose-500/5 border border-rose-500/10 rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2 text-rose-500">
            <AlertCircle size={12} />
            <span className="text-[11px] font-black">수익 발생 시작 지점 (BEP)</span>
          </div>
          <div className="flex items-end justify-between">
            <p className="text-xl font-black text-rose-500">
              ₩{Math.ceil(calculations.bepPrice).toLocaleString()}
            </p>
            <p className="text-xs font-bold text-rose-500/70 mb-0.5">
              +{calculations.bepPct.toFixed(2)}% 이상
            </p>
          </div>
          <p className="text-[10px] text-zinc-500 mt-2 leading-relaxed">
            * 수수료와 거래세(0.21%)를 제외하고 실제로 수익으로 전환되는 가격입니다.
          </p>
        </div>

        {/* 목표 수익률 설정 */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider block">
              목표 수익률 설정
            </label>
            <span className="text-xs font-black text-emerald-500">+{targetPct}%</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="30"
            step="0.5"
            value={targetPct}
            onChange={(e) => setTargetPct(Number(e.target.value))}
            className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
          />
        </div>

        {/* 예상 실전 수익 */}
        <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-black text-emerald-500 uppercase flex items-center gap-1.5">
              <TrendingUp size={12} /> 예상 실전 순수익
            </span>
            <span className="text-[10px] font-bold text-emerald-500/50 italic">Net Profit</span>
          </div>
          <div className="flex items-end justify-between">
            <p className="text-2xl font-black text-emerald-500">
              +₩{Math.floor(calculations.pureProfit).toLocaleString()}
            </p>
            <div className="text-right">
              <p className="text-sm font-black text-emerald-500">
                +{calculations.realProfitPct.toFixed(2)}%
              </p>
              <p className="text-[10px] text-zinc-500 font-bold">실질 수익률</p>
            </div>
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-2 p-3 bg-zinc-800/30 rounded-xl text-zinc-500">
        <Info size={14} className="shrink-0" />
        <p className="text-[10px] font-medium leading-tight">
          이 계산은 온라인 평균 수수료와 국내 주식 세금을 기준으로 산출되었습니다. 실제 증권사별 수수료율에 따라 오차가 발생할 수 있습니다.
        </p>
      </div>
    </div>
  );
}
