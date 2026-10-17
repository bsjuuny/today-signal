import fs from 'node:fs';
import path from 'node:path';
import type { MarketContext, TodaySignalData } from '../types/stock';

/** Fail closed for both the website and the legacy trader (which reads arrays). */
export function saveUnavailableMarket(market: MarketContext, date: string, outputPath: string, traderPath: string): TodaySignalData {
  const failed: TodaySignalData = {
    status: 'failed', date, market,
    signals: { instBuy: [], foreignBuy: [], volumeSurge: [], strongDemand: [], momentum: [] },
    updatedAt: new Date().toISOString(),
  };
  const text = JSON.stringify(failed, null, 2);
  for (const destination of [outputPath, traderPath]) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    // Readers must never observe a partially written JSON file.
    const temporary = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, text);
    fs.renameSync(temporary, destination);
  }
  return failed;
}
