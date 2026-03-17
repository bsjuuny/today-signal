/**
 * 한국투자증권 KIS Developers API
 * https://apiportal.koreainvestment.com
 *
 * 환경변수:
 *   KIS_APP_KEY     - 앱 키
 *   KIS_APP_SECRET  - 앱 시크릿
 *
 * 참고: KIS 토큰은 1분에 1회만 발급 가능 → 파일 캐시로 프로세스 재시작에도 유지
 */

import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://openapi.koreainvestment.com:9443';
const TOKEN_CACHE_PATH = path.join(process.cwd(), '.kis_token_cache.json');

interface TokenCache {
  value: string;
  expiresAt: number;
}

let _token: TokenCache | null = null;
let _tokenPromise: Promise<string> | null = null;

function loadTokenCache(): TokenCache | null {
  try {
    if (!fs.existsSync(TOKEN_CACHE_PATH)) return null;
    const cache = JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH, 'utf-8')) as TokenCache;
    if (Date.now() < cache.expiresAt) return cache;
  } catch {}
  return null;
}

function saveTokenCache(cache: TokenCache) {
  try {
    fs.writeFileSync(TOKEN_CACHE_PATH, JSON.stringify(cache));
  } catch {}
}

/** OAuth 토큰 발급 (메모리 + 파일 캐시, 1분 제한 및 동시 요청 대응) */
async function getToken(): Promise<string> {
  // 1) 메모리 캐시
  if (_token && Date.now() < _token.expiresAt) return _token.value;
  // 2) 파일 캐시
  const cached = loadTokenCache();
  if (cached) { _token = cached; return _token.value; }

  // 3) 중복 요청 방지 (Singleton Promise)
  if (_tokenPromise) return _tokenPromise;

  _tokenPromise = (async () => {
    try {
      return await _issueToken();
    } finally {
      _tokenPromise = null;
    }
  })();

  return _tokenPromise;
}

async function _issueToken(retry = true): Promise<string> {
  const res = await fetch(`${BASE_URL}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
    }),
  });

  const body = await res.text().catch(() => '');
  if (!res.ok) {
    // 1분 제한 오류(EGW00133)인 경우 1회 대기 후 재시도
    if (retry && body.includes('EGW00133')) {
      console.warn(`[KIS] 토큰 발급 제한(1분) 감지됨. 65초 대기 후 재시도합니다...`);
      await new Promise(r => setTimeout(r, 65000));
      return await _issueToken(false);
    }
    throw new Error(`KIS 토큰 발급 실패: HTTP ${res.status}\n  ${body.slice(0, 300)}`);
  }

  const data = JSON.parse(body);
  _token = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  saveTokenCache(_token);
  return _token.value;
}

/** KIS API 공통 헤더 */
async function headers(trId: string, extra: Record<string, string> = {}) {
  const token = await getToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    appkey: process.env.KIS_APP_KEY!,
    appsecret: process.env.KIS_APP_SECRET!,
    tr_id: trId,
    custtype: 'P',
    ...extra,
  };
}

/** 레이트 리밋 대기 */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** 가장 최근 거래일(평일) 날짜 반환 — YYYYMMDD */
export function getLastTradingDate(): string {
  const d = new Date();
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const kstMinutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  // 장 시작 전(09:00 이전)에만 전일로 — 장중/장마감은 오늘 날짜 유지
  if (kstMinutes < 9 * 60) kst.setUTCDate(kst.getUTCDate() - 1);
  // 토=6, 일=0 → 금요일로 이동
  const dow = kst.getUTCDay();
  if (dow === 0) kst.setUTCDate(kst.getUTCDate() - 2);
  if (dow === 6) kst.setUTCDate(kst.getUTCDate() - 1);
  return kst.toISOString().slice(0, 10).replace(/-/g, '');
}

/** fetch + JSON 파싱 (오류 시 상세 메시지 포함) */
async function fetchJson(url: string, h: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: h });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`KIS API 오류 ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`JSON 파싱 실패 (${res.status}): ${text.slice(0, 200)}`);
  }
}

// ──────────────────────────────────────────────
// 1. 업종별 등락률 (코스피/코스닥 지수)
// ──────────────────────────────────────────────
export interface IndexQuote {
  name: string;
  currentPrice: number;
  change: number;
  changePct: number;
  volume: number;
  tradingValue: number; // 거래대금 (원)
}

export async function getIndexQuote(code: '0001' | '1001'): Promise<IndexQuote> {
  // 0001=코스피, 1001=코스닥
  const h = await headers('FHPUP02100000');
  const url = `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-index-price?FID_COND_MRKT_DIV_CODE=U&FID_INPUT_ISCD=${code}`;
  const data = await fetchJson(url, h);
  const o = data.output as Record<string, string>;
  if (!o.acml_tr_pbmn) {
    console.warn(`  [KIS] acml_tr_pbmn 필드 누락 (code=${code}). output keys: ${Object.keys(o).join(', ')}`);
  }
  return {
    name: o.hts_kor_isnm,
    currentPrice: parseFloat(o.bstp_nmix_prpr),
    change: parseFloat(o.bstp_nmix_prdy_vrss),
    changePct: parseFloat(o.bstp_nmix_prdy_ctrt),
    volume: parseInt(o.acml_vol),
    tradingValue: parseInt(o.acml_tr_pbmn || '0'), // 누적거래대금 (원)
  };
}

// ──────────────────────────────────────────────
// 2. 종목 현재가 조회
// ──────────────────────────────────────────────
export interface StockQuote {
  code: string;
  name: string;
  price: number;
  priceChange: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  marketCap: number; // 억원
}

export async function getStockQuote(code: string): Promise<StockQuote> {
  const h = await headers('FHKST01010100');
  const url = `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code}`;
  const data = await fetchJson(url, h);
  const o = data.output as Record<string, string>;
  return {
    code,
    name: o.hts_kor_isnm,
    price: parseInt(o.stck_prpr),
    priceChange: parseInt(o.prdy_vrss),
    changePct: parseFloat(o.prdy_ctrt),
    open: parseInt(o.stck_oprc),
    high: parseInt(o.stck_hgpr),
    low: parseInt(o.stck_lwpr),
    volume: parseInt(o.acml_vol),
    marketCap: parseInt(o.hts_avls || '0'), // 억원 (KIS API가 이미 억원 단위로 반환)
  };
}

// ──────────────────────────────────────────────
// 3. 기관/외국인 순매수 상위 종목
// ──────────────────────────────────────────────
export interface NetBuyItem {
  rank: number;
  code: string;
  name: string;
  price: number;
  changePct: number;
  netBuyQty: number;    // 순매수 수량
  netBuyAmt: number;    // 순매수 금액 (원)
  volume: number;
}

/** 기관 순매수 상위 (당일)
 * tr_id: FHPTJ04400000 — 투자자별 매매동향
 * KIS API: /uapi/domestic-stock/v1/quotations/investor-trend-estimate
 * FID_BLNG_CLS_CODE: 0=전체, 1=기관합계, 2=외국인
 */
export async function getInstNetBuyTop(limit = 30): Promise<NetBuyItem[]> {
  const h = await headers('FHPTJ04400000');
  const date = getLastTradingDate();
  const url = `${BASE_URL}/uapi/domestic-stock/v1/quotations/investor-trend-estimate`
    + `?FID_COND_MRKT_DIV_CODE=J&FID_COND_SCR_DIV_CODE=20172&FID_INPUT_ISCD=0000`
    + `&FID_DIV_CLS_CODE=0&FID_BLNG_CLS_CODE=1&FID_TRGT_CLS_CODE=111111111`
    + `&FID_TRGT_EXLS_CLS_CODE=000000&FID_INPUT_PRICE_1=&FID_INPUT_PRICE_2=`
    + `&FID_VOL_CNT=&FID_INPUT_DATE_1=${date}&FID_RANK_SORT_CLS_CODE=0&FID_ETC_CLS_CODE=0`;
  const data = await fetchJson(url, h);
  if (data.rt_cd !== '0') {
    console.warn(`  [기관순매수] API 응답 오류: rt_cd=${data.rt_cd}, msg=${data.msg1}`);
    return [];
  }
  const rows: NetBuyItem[] = ((data.output as Record<string, string>[]) ?? []).slice(0, limit).map((o, i) => ({
    rank: i + 1,
    code: o.mksc_shrn_iscd,
    name: o.hts_kor_isnm,
    price: parseInt(o.stck_prpr || '0'),
    changePct: parseFloat(o.prdy_ctrt || '0'),
    netBuyQty: parseInt(o.inst_ntby_qty || '0'),
    netBuyAmt: parseInt(o.inst_ntby_tr_pbmn || '0'),
    volume: parseInt(o.acml_vol || '0'),
  }));
  return rows;
}

/** 외국인 순매수 상위 (당일)
 * FID_BLNG_CLS_CODE: 2=외국인
 */
export async function getForeignNetBuyTop(limit = 30): Promise<NetBuyItem[]> {
  const h = await headers('FHPTJ04400000');
  const date = getLastTradingDate();
  const url = `${BASE_URL}/uapi/domestic-stock/v1/quotations/investor-trend-estimate`
    + `?FID_COND_MRKT_DIV_CODE=J&FID_COND_SCR_DIV_CODE=20172&FID_INPUT_ISCD=0000`
    + `&FID_DIV_CLS_CODE=0&FID_BLNG_CLS_CODE=2&FID_TRGT_CLS_CODE=111111111`
    + `&FID_TRGT_EXLS_CLS_CODE=000000&FID_INPUT_PRICE_1=&FID_INPUT_PRICE_2=`
    + `&FID_VOL_CNT=&FID_INPUT_DATE_1=${date}&FID_RANK_SORT_CLS_CODE=0&FID_ETC_CLS_CODE=0`;
  const data = await fetchJson(url, h);
  if (data.rt_cd !== '0') {
    console.warn(`  [외국인순매수] API 응답 오류: rt_cd=${data.rt_cd}, msg=${data.msg1}`);
    return [];
  }
  const rows: NetBuyItem[] = ((data.output as Record<string, string>[]) ?? []).slice(0, limit).map((o, i) => ({
    rank: i + 1,
    code: o.mksc_shrn_iscd,
    name: o.hts_kor_isnm,
    price: parseInt(o.stck_prpr || '0'),
    changePct: parseFloat(o.prdy_ctrt || '0'),
    netBuyQty: parseInt(o.frgn_ntby_qty || '0'),
    netBuyAmt: parseInt(o.frgn_ntby_tr_pbmn || '0'),
    volume: parseInt(o.acml_vol || '0'),
  }));
  return rows;
}

// ──────────────────────────────────────────────
// 4. 거래량 급등 상위
// ──────────────────────────────────────────────
export interface VolumeSurgeItem {
  rank: number;
  code: string;
  name: string;
  price: number;
  changePct: number;
  volume: number;
  volumeRatio: number;  // 전일 대비 거래량 비율
}

export async function getVolumeSurgeTop(limit = 30): Promise<VolumeSurgeItem[]> {
  const h = await headers('FHPST01710000');
  const url = `${BASE_URL}/uapi/domestic-stock/v1/quotations/volume-rank`
    + `?FID_COND_MRKT_DIV_CODE=J&FID_COND_SCR_DIV_CODE=20171&FID_INPUT_ISCD=0000`
    + `&FID_DIV_CLS_CODE=0&FID_BLNG_CLS_CODE=0&FID_TRGT_CLS_CODE=111111111`
    + `&FID_TRGT_EXLS_CLS_CODE=000000&FID_INPUT_PRICE_1=&FID_INPUT_PRICE_2=`
    + `&FID_VOL_CNT=100000&FID_INPUT_DATE_1=`;
  const data = await fetchJson(url, h);
  if (data.rt_cd !== '0') {
    console.warn(`  [거래량급등] API 응답 오류: rt_cd=${data.rt_cd}, msg=${data.msg1}`);
    return [];
  }
  const rows: VolumeSurgeItem[] = ((data.output as Record<string, string>[]) ?? []).slice(0, limit).map((o, i) => ({
    rank: i + 1,
    code: o.mksc_shrn_iscd,
    name: o.hts_kor_isnm,
    price: parseInt(o.stck_prpr || '0'),
    changePct: parseFloat(o.prdy_ctrt || '0'),
    volume: parseInt(o.acml_vol || '0'),
    volumeRatio: parseFloat(o.vol_inrt || '0'), // 전일 대비 %
  }));
  return rows;
}

// ──────────────────────────────────────────────
// 5. 종목 기간별 투자자 순매수 (연속 매수 계산용)
// ──────────────────────────────────────────────
export interface InvestorDaily {
  date: string;
  instNetBuy: number;
  foreignNetBuy: number;
}

export async function getInvestorHistory(code: string, days = 10): Promise<InvestorDaily[]> {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - days * 2); // 영업일 보정

  const toStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const fromStr = from.toISOString().slice(0, 10).replace(/-/g, '');

  const h = await headers('FHKST03010100');
  const url = `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`
    + `?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code}`
    + `&FID_INPUT_DATE_1=${fromStr}&FID_INPUT_DATE_2=${toStr}&FID_PERIOD_DIV_CODE=D&FID_ORG_ADJ_PRC=0`;
  const data = await fetchJson(url, h);

  return ((data.output2 as Record<string, string>[]) ?? []).slice(0, days).map((o) => ({
    date: o.stck_bsop_date,
    instNetBuy: parseInt(o.inst_ntby_qty || '0'),
    foreignNetBuy: parseInt(o.frgn_ntby_qty || '0'),
  }));
}

/** 연속 순매수/매도 일수 계산 */
export function calcConsecutiveDays(history: InvestorDaily[], type: 'inst' | 'foreign'): number {
  const values = history.map(d => type === 'inst' ? d.instNetBuy : d.foreignNetBuy);
  if (values.length === 0) return 0;

  const direction = values[0] > 0 ? 1 : values[0] < 0 ? -1 : 0;
  if (direction === 0) return 0;

  let count = 0;
  for (const v of values) {
    if ((direction > 0 && v > 0) || (direction < 0 && v < 0)) count++;
    else break;
  }
  return direction * count;
}

/** 20일 평균 거래량 조회 */
export async function getAvgVolume20(code: string): Promise<number> {
  await sleep(100);
  const h = await headers('FHKST03010100');
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 35);
  const toStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const fromStr = from.toISOString().slice(0, 10).replace(/-/g, '');

  const url = `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`
    + `?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code}`
    + `&FID_INPUT_DATE_1=${fromStr}&FID_INPUT_DATE_2=${toStr}&FID_PERIOD_DIV_CODE=D&FID_ORG_ADJ_PRC=0`;
  const data = await fetchJson(url, h);
  const vols: number[] = ((data.output2 as Record<string, string>[]) ?? []).slice(0, 20).map((o) => parseInt(o.acml_vol || '0'));
  if (vols.length === 0) return 0;
  return Math.round(vols.reduce((a, b) => a + b, 0) / vols.length);
}

export { sleep };
