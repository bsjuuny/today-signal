import fs from 'node:fs';
import path from 'node:path';

/**
 * KIS 숫자 필드 엄격 파싱. 빈 값/없음은 0(기존 동작 유지), 숫자가 아닌 글자는 오류.
 * parseInt('N/A') 가 NaN 이 되어 `NaN < 500` 같은 탈락 조건을 통과하던 경로를 막는다.
 */
export function kisNumber(value: unknown, field: string): number {
  if (value === undefined || value === null) return 0;
  const raw = String(value).trim();
  if (raw === '') return 0;
  // 쉼표는 1,234,567 처럼 세 자리 구분일 때만 허용
  if (!/^[+-]?(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$/.test(raw)) throw new Error(`KIS 숫자 필드 이상: ${field}=${JSON.stringify(String(value).slice(0, 20))}`);
  const n = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new Error(`KIS 숫자 필드 이상: ${field}`);
  return n;
}

export function kisInt(value: unknown, field: string): number {
  const n = kisNumber(value, field);
  if (!Number.isInteger(n)) throw new Error(`KIS 정수 필드 이상: ${field}=${n}`);
  return n;
}

/**
 * KIS 선택 숫자 필드 파싱. 빈 값은 실제 0과 구분하기 위해 null로 보존한다.
 * 수급처럼 0이 유효한 관측값인 필드에 사용한다.
 */
export function kisOptionalInt(value: unknown, field: string): number | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return kisInt(value, field);
}

/** 응답의 목록 필드가 실제 배열인지 확인. 빈 배열은 정상, 없거나 다른 형식이면 오류. */
export function kisRows(data: Record<string, unknown>, key: string, label: string): Record<string, string>[] {
  const rows = data[key];
  if (!Array.isArray(rows)) throw new Error(`[${label}] 응답에 ${key} 목록 없음`);
  return rows as Record<string, string>[];
}

/** 읽는 쪽이 쓰다 만 JSON 을 보지 않도록 임시 파일에 쓴 뒤 교체한다. */
export function writeJsonAtomic(destination: string, data: unknown): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2));
  fs.renameSync(temporary, destination);
}

/**
 * 공매도 잔고 자료가 쓸 만큼 최근인지. 기준일(YYYYMMDD)이 오늘(YYYYMMDD)보다
 * 평일 기준 maxWeekdays 일 넘게 지났거나 미래면 버린다(휴장일은 모르므로 평일로 센다).
 */
export function isRecentTradingDate(dataDate: unknown, today: string, maxWeekdays = 3): boolean {
  if (typeof dataDate !== 'string' || !/^\d{8}$/.test(dataDate) || !/^\d{8}$/.test(today)) return false;
  if (dataDate > today) return false;
  const toDate = (s: string) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
  const d = toDate(dataDate);
  const end = toDate(today);
  // 20260231 처럼 없는 날짜는 Date 가 다음 달로 넘겨 버리므로 되돌려 비교한다
  const back = (x: Date) => x.toISOString().slice(0, 10).replace(/-/g, '');
  if (back(d) !== dataDate || back(end) !== today) return false;
  let weekdays = 0;
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) weekdays++;
    if (weekdays > maxWeekdays) return false;
  }
  return true;
}
