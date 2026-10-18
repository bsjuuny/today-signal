# 시장 데이터 검증 및 운영 재개 조건

검토일: 2026-10-17. 기준 커밋: 881c552.

## 확인한 사실

- 저장 이력 112개 중 거래대금 0은 108개. 양 지수 등락률이 모두 0인 98개는 모두 오전 9시 이전(KST)에 수집됐다. 100개가 장전 수집이다. 이는 초기화/장전 응답 가능성을 강하게 시사하지만 원본 응답이 없어 확정할 수 없다.
- 10월 14·15일 파일은 각각 다음 날 오전 08:25 KST 수집. 16일 파일은 16:10 KST 수집이고 신호 합계 20개. 16일의 0이 누락인지 잘못된 환산/반올림인지 저장본만으로 구별할 수 없다.
- 기존 코드는 응답 성공 코드, 숫자 유효성, 시장 활동 여부를 검증하지 않고 빈 값을 0으로 바꾼다. parseFloat/parseInt는 부분 문자열도 수용한다.
- 거래대금을 무조건 원으로 보고 1억으로 나눈 뒤 반올림한다. 공식 예시의 acml_tr_pbmn=11507962에 기존 계산을 적용하면 0억이 된다. 백만원 단위라면 115079.62억원이므로 단위 가정만으로 100만 배 차이가 난다.

## 공식 근거와 한계

- [KIS 공식 명세](https://apiportal.koreainvestment.com/apiservice-apiservice?/uapi/domestic-stock/v1/quotations/inquire-index-price)
- [공개 명세 JSON](https://apiportal.koreainvestment.com/api/apis/public/detail?accessUrl=%2Fuapi%2Fdomestic-stock%2Fv1%2Fquotations%2Finquire-index-price)
- [공식 예제](https://github.com/koreainvestment/open-trading-api/blob/2077773a69a428daf63e148182511f068cc45de3/examples_llm/domestic_stock/inquire_index_price/inquire_index_price.py)

공식 명세는 TR FHPUP02100000, 시장 U, 0001/1001 코드, output 및 필드명을 확인해 준다. acml_tr_pbmn은 필수 문자열(길이 18), 이름은 누적 거래 대금이다. 그러나 description은 공백이고 단위가 명시돼 있지 않다. 공식 응답 예시와 필드 명세 발췌를 tests/fixtures에 보존했다. 백만원 단위는 유력하지만 공식 확인이 끝났다고 주장할 수 없다. 금액 규모로 단위를 자동 추측하지 않는다.

## 변경 동작

- 누락·빈 문자열·부분 숫자·비유한 수치를 null로 표현. API 업무 오류/출력 구조/등락률과 부호·전일대비·계산값 불일치를 검증한다.
- 명시적 0은 파싱상 0으로 보존. 거래가 있는 진짜 보합(부호 3)은 허용한다. 거래량/거래대금 0은 현재 세션의 유효성을 입증하지 못하므로 신호 평가에서 제외한다.
- 장전 및 주말 현재지수 응답은 평가에서 제외한다. 전일 종가로 몰래 대체하지 않는다. 현재지수 API는 영업일 필드를 제공하지 않아 장전 응답을 전일 데이터라고 확정할 수 없다.
- quality에 원본 주요 필드·출처·단위·실패 사유를 저장한다. 거래대금은 단위를 명시적으로 설정한 뒤 한 번만 환산하고 정수 반올림을 제거한다.
- 검증 실패 시 웹/트레이더 JSON에 status=failed와 빈 신호 배열을 원자적 파일 교체로 기록하고 비정상 종료한다. 기존 정상 아카이브는 덮어쓰지 않는다. 두 파일 간 분산 트랜잭션은 아니므로 전파 오류는 운영 로그 확인이 필요하다.
- 점수 함수 5개, 시장 배율, 성과 평가, 화면 모두 미검증 데이터를 차단한다. 이전 스키마 파일은 quality가 없어 미검증으로 처리한다. 과거 신호/점수를 유효한 것으로 재해석하거나 실제 값을 만들어 채우지 않는다.

## 운영 재개 전 필요한 확인

1. KIS에 이 TR의 acml_tr_pbmn 단위를 공식 확인하거나, 권한 있는 환경의 원본 응답과 같은 시각 HTS [0210] 거래대금을 대조한다. 이 환경에서는 운영 키/공유 토큰 캐시가 없으므로 실제 호출을 수행하지 않았다.
2. 확인된 단위만 `KIS_INDEX_TRADING_VALUE_UNIT=MILLION_KRW` 또는 `KRW`로 수집 프로세스에 설정한다. 미설정/다른 값이면 신호 제공은 중단된다. 현재 정적 사이트를 재빌드하면 과거 미검증 신호도 표시되지 않는다.
3. 장중/장후 수집 결과에서 quality.status=valid, raw, 환산값을 검증한 뒤 배포한다. 장전 운영이 필요하면 날짜가 명시된 일별지수 API와 거래일 달력으로 별도 구현해야 한다.
4. KIS-Trader/외부 scheduler는 이 저장소에 없다. 빈 배열 전달로 기존 배열 소비자를 보호하지만, 외부 소비자의 status/null 처리와 파일 전파 실패 시 동작은 그 저장소에서 추가 확인해야 한다.

## 운영 재개 (2026-10-19)

- 운영자 확인으로 `KIS_INDEX_TRADING_VALUE_UNIT=MILLION_KRW`를 scheduler `run-today-signal.mjs`에서 설정. 근거: 공식 예시 코스닥 857.60에 acml_tr_pbmn=11507962는 백만원이면 11.5조원, 원이면 1,150만원.
- 08:25 장전 실행은 현재지수가 검증 불가라 새로 수집하지 않는다. scheduler(`lib/preopen-signal.mjs`)가 직전 거래일 장마감 기록(`history/signal_<직전 거래일>.json`)이 completed·quality valid·15:30 이후 수집일 때만 오늘 날짜로 kis-trader에 재전달한다(`source.type=previous-close`). 아니면 빈 신호로 비운다. 간밤 미국장은 market-checker `mode.json`(오늘 날짜일 때)을 `overnight`에 참고용으로만 붙인다. 매매 모드는 kis-trader가 같은 파일로 결정하므로 신호를 다시 거르지 않는다.
- collect-data를 장전에 직접 실행하면 실패 JSON만 기록하고 정상 종료한다.
- 실패 JSON의 트레이더 경로를 `kis-trader/data/today/today_signal.json`(실제 소비 파일)으로 수정. 이전 `data/today_signal.json`은 아무도 읽지 않아 금요일 신호가 `data/today/`에 남아 있었다.

## 재현 및 검증

- `npm test`: 공식 응답 fixture, 엄격 파싱, 0/누락 구분, 단위 계약별 환산, 장전 응답, 불일치 등락률, 모든 점수 진입점, UI, 10월 14–16일 회귀, 실패 JSON 저장/트레이더 이전 신호 제거.
- `npm run data:audit`: 네트워크/운영 데이터 변경 없는 전체 이력 감사.
- `npx tsc --noEmit`: 타입 확인.

과거 112개 파일은 원본 그대로 보존하며 모두 단위/원본 검증 이력이 없어 평가 대상에서 제외한다. 이 변경은 운영 재개를 위한 데이터 복구 완료본이 아니라, 확인되지 않은 시장 수치로 신호를 생성하지 않게 하는 보호 수정이다.
