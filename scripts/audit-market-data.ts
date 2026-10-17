import fs from 'node:fs';
import path from 'node:path';
import { isMarketUsable } from '../lib/market-data';
import type { TodaySignalData } from '../types/stock';
const directory = path.join(process.cwd(), 'public/data/history');
const rows = fs.readdirSync(directory).filter(f => /^signal_\d{8}\.json$/.test(f)).sort().map(file => {
  const data: TodaySignalData = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
  const kst = new Date(new Date(data.market.fetchedAt).getTime() + 9 * 3600000);
  return {file, zeroValue: data.market.kospiVolume === 0,
    flatBoth: data.market.kospiChange === 0 && data.market.kosdaqChange === 0,
    preOpen: kst.getUTCHours() < 9,
    usable: isMarketUsable(data.market)};
});
console.log(JSON.stringify({total: rows.length, zeroValue: rows.filter(r => r.zeroValue).length,
  flatBoth: rows.filter(r => r.flatBoth).length,
  preOpen: rows.filter(r => r.preOpen).length,
  flatBothPreOpen: rows.filter(r => r.flatBoth && r.preOpen).length,
  usable: rows.filter(r => r.usable).length,
  recent: rows.filter(r => r.file >= 'signal_20261014')}, null, 2));
