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

const BASE_URL = 'https://openapi.koreainvestment.com:9443';

interface TokenCache {
  value: string;
  expiresAt: number;
}

interface SharedCacheModule {
  loadSharedToken(args: { environment: string; appKey: string | undefined }): { accessToken: string; expiresAt: number } | null;
  invalidateSharedToken(args: { environment: string; appKey: string | undefined }): void;
  withSharedTokenLock<T>(
    args: { environment: string; appKey: string | undefined },
    fn: (ctx: { cached: { accessToken: string; expiresAt: number } | null; save: (token: string, expiresInSeconds: number) => void }) => Promise<T>,
  ): Promise<T>;
}

let _sharedCache: SharedCacheModule | null = null;
// CJS로 컴파일하는 도구(ts-node 등)는 `import()`조차 컴파일 시점에 require()로
// 다운레벨링해서 .mjs를 못 읽는다(ERR_REQUIRE_ESM) — TS 정적 분석이 보지 못하게
// new Function으로 감싸 진짜 런타임 동적 import를 강제한다 (forex-signal/lib/kis-api.ts와
// 동일 패턴).
const _dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;
async function sharedCache(): Promise<SharedCacheModule> {
  if (!_sharedCache) {
    const { pathToFileURL } = await import('url');
    _sharedCache = (await _dynamicImport(pathToFileURL('C:/github/scheduler/lib/kis-token-cache.mjs').href)) as SharedCacheModule;
  }
  return _sharedCache;
}

let _token: TokenCache | null = null;
let _tokenPromise: Promise<string> | null = null;

/**
 * kis-quant-lab(실거래 엔진) 등 같은 KIS 앱키를 쓰는 다른 프로세스와 공유하는 캐시.
 * KIS는 같은 앱키로 새 토큰을 발급하면 기존 유효 토큰을 즉시 무효화하므로, 독립적으로
 * 재발급하면 서로의 토큰을 깨뜨린다 - 그래서 파일 하나가 아니라 이 공유 캐시를 거친다.
 */
async function loadTokenCache(): Promise<TokenCache | null> {
  try {
    const { loadSharedToken } = await sharedCache();
    const cached = loadSharedToken({ environment: 'live', appKey: process.env.KIS_APP_KEY });
    return cached ? { value: cached.accessToken, expiresAt: cached.expiresAt } : null;
  } catch {
    return null;
  }
}

/** OAuth 토큰 발급 (메모리 + 공유 캐시, 1분 제한 및 동시 요청 대응) */
async function getToken(): Promise<string> {
  // 1) 메모리 캐시
  if (_token && Date.now() < _token.expiresAt) return _token.value;
  // 2) 공유 캐시 (다른 프로세스가 이미 발급해뒀을 수 있음)
  const cached = await loadTokenCache();
  if (cached) { _token = cached; return cached.value; }

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

async function _issueTokenHttp(): Promise<{ access_token: string; expires_in: number }> {
  let lastError: Error | null = null;
  for (const retry of [true, false]) {
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
    if (res.ok) return JSON.parse(body);

    // 1분 제한 오류(EGW00133)인 경우 1회 대기 후 재시도
    if (retry && body.includes('EGW00133')) {
      console.warn(`[KIS] 토큰 발급 제한(1분) 감지됨. 65초 대기 후 재시도합니다...`);
      await new Promise(r => setTimeout(r, 65000));
      continue;
    }
    lastError = new Error(`KIS 토큰 발급 실패: HTTP ${res.status}\n  ${body.slice(0, 300)}`);
    break;
  }
  throw lastError;
}

/**
 * 캐시 재확인 → 없으면 발급 → 저장을 공유 락 하나로 원자적으로 수행 (동시 재발급으로
 * 서로의 토큰을 무효화하는 경쟁 방지). 락 안에서도 다른 프로세스가 방금 발급해뒀을 수
 * 있으므로 cached를 다시 확인한다.
 */
async function _issueToken(): Promise<string> {
  const { withSharedTokenLock } = await sharedCache();
  return withSharedTokenLock(
    { environment: 'live', appKey: process.env.KIS_APP_KEY },
    async ({ cached, save }) => {
      if (cached) {
        _token = { value: cached.accessToken, expiresAt: cached.expiresAt };
        return cached.accessToken;
      }
      const data = await _issueTokenHttp();
      save(data.access_token, data.expires_in);
      _token = {
        value: data.access_token,
        expiresAt: Date.now() + (data.expires_in - 60) * 1000,
      };
      return _token.value;
    },
  );
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

// 같은 프로세스의 KIS 요청을 직렬화한다. 별도 자동매매 프로세스도 같은 앱 키를
// 사용하며 실제 계정에서 1초 미만 연속 호출이 EGW00201을 반환하므로 여유를 둔다.
const KIS_MIN_REQUEST_INTERVAL_MS = 1100;
const KIS_RATE_LIMIT_RETRY_DELAYS_MS = [1500, 3000, 6000, 10000];
let _lastRequestStartedAt = 0;
let _requestChain: Promise<unknown> = Promise.resolve();

function rateLimitedFetch(url: string, h: Record<string, string>): Promise<Response> {
  const request = _requestChain.then(async () => {
    const elapsed = Date.now() - _lastRequestStartedAt;
    if (elapsed < KIS_MIN_REQUEST_INTERVAL_MS) {
      await sleep(KIS_MIN_REQUEST_INTERVAL_MS - elapsed);
    }
    _lastRequestStartedAt = Date.now();
    return fetch(url, { headers: h });
  });

  // 실패한 요청 때문에 뒤의 요청 큐가 함께 중단되지 않도록 체인을 복구한다.
  _requestChain = request.then(() => undefined, () => undefined);
  return request;
}

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
async function fetchJson(
  url: string,
  h: Record<string, string>,
  tokenRetry = true,
  rateLimitAttempt = 0,
): Promise<Record<string, unknown>> {
  const res = await rateLimitedFetch(url, h);
  const text = await res.text();

  // 초당 거래건수 제한은 HTTP 500으로 주로 오지만, 응답 상태와 무관하게
  // 오류코드로 판별한다. 대기 시간을 늘리며 최대 4회 재시도한다.
  if (text.includes('EGW00201') && rateLimitAttempt < KIS_RATE_LIMIT_RETRY_DELAYS_MS.length) {
    const baseDelay = KIS_RATE_LIMIT_RETRY_DELAYS_MS[rateLimitAttempt];
    const delay = baseDelay + Math.floor(Math.random() * 250);
    console.warn(`[KIS] 초당 호출 제한 감지 — ${delay}ms 대기 후 재시도 (${rateLimitAttempt + 1}/${KIS_RATE_LIMIT_RETRY_DELAYS_MS.length})`);
    await sleep(delay);
    return fetchJson(url, h, tokenRetry, rateLimitAttempt + 1);
  }

  if (!res.ok) {
    // 토큰 만료(EGW00123) → 캐시 무효화 후 1회 재시도
    if (tokenRetry && text.includes('EGW00123')) {
      console.warn('[KIS] 토큰 만료 감지 — 재발급 후 재시도');
      _token = null;
      try { (await sharedCache()).invalidateSharedToken({ environment: 'live', appKey: process.env.KIS_APP_KEY }); } catch {}
      const trId = h['tr_id'] ?? '';
      const newHeaders = await headers(trId);
      return fetchJson(url, newHeaders, false, rateLimitAttempt);
    }
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
    currentPrice: parseFloat(o.bstp_nmix_prpr || '0'),
    change: parseFloat(o.bstp_nmix_prdy_vrss || '0'),
    changePct: parseFloat(o.bstp_nmix_prdy_ctrt || '0'),
    volume: parseInt(o.acml_vol || '0'),
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
    price: parseInt(o.stck_prpr || '0'),
    priceChange: parseInt(o.prdy_vrss || '0'),
    changePct: parseFloat(o.prdy_ctrt || '0'),
    open: parseInt(o.stck_oprc || '0'),
    high: parseInt(o.stck_hgpr || '0'),
    low: parseInt(o.stck_lwpr || '0'),
    volume: parseInt(o.acml_vol || '0'),
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
  const url = `${BASE_URL}/uapi/domestic-stock/v1/quotations/foreign-institution-total`
    + `?FID_COND_MRKT_DIV_CODE=J&FID_COND_SCR_DIV_CODE=20171&FID_INPUT_ISCD=0001`
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
    netBuyQty: parseInt(o.orgn_ntby_qty || '0'),
    netBuyAmt: parseInt(o.orgn_ntby_tr_pbmn || '0'),
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
  const url = `${BASE_URL}/uapi/domestic-stock/v1/quotations/foreign-institution-total`
    + `?FID_COND_MRKT_DIV_CODE=J&FID_COND_SCR_DIV_CODE=20171&FID_INPUT_ISCD=0001`
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

export async function getVolumeSurgeTop(limit = 50, market: 'J' | 'Q' = 'J'): Promise<VolumeSurgeItem[]> {
  const h = await headers('FHPST01710000');
  // 코스피: FID_INPUT_ISCD=0000(전체), 코스닥: FID_INPUT_ISCD=1000
  const iscd = market === 'J' ? '0000' : '1000';
  const url = `${BASE_URL}/uapi/domestic-stock/v1/quotations/volume-rank`
    + `?FID_COND_MRKT_DIV_CODE=J&FID_COND_SCR_DIV_CODE=20171&FID_INPUT_ISCD=${iscd}`
    + `&FID_DIV_CLS_CODE=0&FID_BLNG_CLS_CODE=0&FID_TRGT_CLS_CODE=111111111`
    + `&FID_TRGT_EXLS_CLS_CODE=000000&FID_INPUT_PRICE_1=&FID_INPUT_PRICE_2=`
    + `&FID_VOL_CNT=100000&FID_INPUT_DATE_1=`;
  const data = await fetchJson(url, h);
  if (data.rt_cd !== '0') {
    console.warn(`  [거래량급등/${market}] API 응답 오류: rt_cd=${data.rt_cd}, msg=${data.msg1}`);
    return [];
  }
  const rows: VolumeSurgeItem[] = ((data.output as Record<string, string>[]) ?? []).slice(0, limit).map((o, i) => ({
    rank: i + 1,
    code: o.mksc_shrn_iscd,
    name: o.hts_kor_isnm,
    price: parseInt(o.stck_prpr || '0'),
    changePct: parseFloat(o.prdy_ctrt || '0'),
    volume: parseInt(o.acml_vol || '0'),
    volumeRatio: parseFloat(o.vol_inrt || '0'),
  }));
  return rows;
}

// ──────────────────────────────────────────────
// 4-1. 등락률 상위 (당일 모멘텀 소스)
// ──────────────────────────────────────────────
export interface ChangePctItem {
  rank: number;
  code: string;
  name: string;
  price: number;
  changePct: number;
  volume: number;
}

export async function getChangePctTop(limit = 50, market: 'J' | 'Q' = 'J'): Promise<ChangePctItem[]> {
  const h = await headers('FHPST01700000');
  // 코스피: FID_INPUT_ISCD=0001, 코스닥: FID_INPUT_ISCD=1001
  const iscd = market === 'J' ? '0001' : '1001';
  const url = `${BASE_URL}/uapi/domestic-stock/v1/ranking/fluctuation`
    + `?fid_cond_mrkt_div_code=J&fid_cond_scr_div_code=20170`
    + `&fid_input_iscd=${iscd}&fid_rank_sort_cls_code=0&fid_input_cnt_1=0`
    + `&fid_prc_cls_code=1&fid_input_price_1=1000&fid_input_price_2=`
    + `&fid_vol_cnt=100000&fid_trgt_cls_code=0&fid_trgt_exls_cls_code=0`
    + `&fid_div_cls_code=0&fid_rsfl_rate1=3&fid_rsfl_rate2=`;
  const data = await fetchJson(url, h);
  if (data.rt_cd !== '0') {
    console.warn(`  [등락률상위/${market}] API 응답 오류: rt_cd=${data.rt_cd}, msg=${data.msg1}`);
    return [];
  }
  const rows: ChangePctItem[] = ((data.output as Record<string, string>[]) ?? []).slice(0, limit).map((o, i) => ({
    rank: i + 1,
    code: o.stck_shrn_iscd || o.mksc_shrn_iscd,
    name: o.hts_kor_isnm,
    price: parseInt(o.stck_prpr || '0'),
    changePct: parseFloat(o.prdy_ctrt || '0'),
    volume: parseInt(o.acml_vol || '0'),
  }));
  return rows.filter(r => r.code && r.price >= 1000);
}

// ──────────────────────────────────────────────
// 5. 종목 기간별 투자자 순매수 (연속 매수 계산용)
// ──────────────────────────────────────────────
export interface InvestorDaily {
  date: string;
  instNetBuy: number;
  instNetBuyAmt: number;
  foreignNetBuy: number;
  foreignNetBuyAmt: number;
}

export async function getInvestorHistory(code: string, days = 10): Promise<InvestorDaily[]> {
  const h = await headers('FHKST01010900');
  const url = `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-investor`
    + `?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code}`;
  const data = await fetchJson(url, h);
  // 장중에는 당일 entry의 투자자 필드가 빈 문자열 → 확정 데이터만 사용
  const confirmed = ((data.output as Record<string, string>[]) ?? [])
    .filter(o => o.orgn_ntby_qty !== '' || o.frgn_ntby_qty !== '');
  return confirmed.slice(0, days).map((o) => ({
    date: o.stck_bsop_date,
    instNetBuy: parseInt(o.orgn_ntby_qty || '0'),
    instNetBuyAmt: parseInt(o.orgn_ntby_tr_pbmn || '0'),
    foreignNetBuy: parseInt(o.frgn_ntby_qty || '0'),
    foreignNetBuyAmt: parseInt(o.frgn_ntby_tr_pbmn || '0'),
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

// ──────────────────────────────────────────────
// 6. 공매도 잔고 히스토리 (종목별)
// ──────────────────────────────────────────────
export interface ShortBalanceDay {
  date: string;   // YYYYMMDD
  qty: number;    // 공매도 잔고 수량
  ratio: number;  // 공매도 잔고 비율 (유동주식 대비 %)
}

/**
 * 종목별 공매도 잔고 히스토리 조회
 * TR: FHPST04830000
 * 반환: 최신순 정렬 (history[0] = 가장 최근)
 */
export async function getShortBalanceHistory(code: string, days = 7): Promise<ShortBalanceDay[]> {
  const h = await headers('FHPST04830000');
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - days * 2); // 주말 포함 여유 있게
  const toStr   = today.toISOString().slice(0, 10).replace(/-/g, '');
  const fromStr = from.toISOString().slice(0, 10).replace(/-/g, '');

  const url = `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-short-sale-status`
    + `?FID_COND_MRKT_DIV_CODE=J`
    + `&FID_INPUT_ISCD=${code}`
    + `&FID_INPUT_DATE_1=${fromStr}`
    + `&FID_INPUT_DATE_2=${toStr}`;

  const data = await fetchJson(url, h);
  const output = (data.output as Record<string, string>[]) ?? [];

  return output
    .slice(0, days)
    .map(o => ({
      date:  o.stck_bsop_date ?? '',
      qty:   parseInt(o.shnu_rsdq  ?? '0'),
      ratio: parseFloat(o.shnu_rsdg_rt ?? '0'),
    }))
    .filter(d => d.date && d.qty > 0);
}

export { sleep };
