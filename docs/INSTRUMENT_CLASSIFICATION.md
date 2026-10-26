# 시장·금융상품 분류

현재 다섯 카테고리는 기업 주식 전용이다. ETF·ETN에 기업 주식의 수급 점수를 부여하지 않는다. 투자상품 전용 신호는 이번 변경에서 제공하지 않는다.

## 공식 정보와 계약

KIS `CTPF1002R /quotations/search-stock-info`를 후보당 한 번 조회한다. `PRDT_TYPE_CD=300`은 주식 전용 구분이 아니라 주식·ETF·ETN·ELW 조회 범위다. `pdno`가 요청 상품번호와 일치해야 한다. Q 접두사, 숫자 형식, 이름은 분류 근거로 사용하지 않는다.

- `scty_grp_id_cd`: ST=기업 주식, EF=ETF, EN=ETN. 미지원 코드는 UNKNOWN으로 처리한다.
- 시장은 공식 `scts_mket_lstg_dt`/`scts_mket_lstg_abol_dt`, `kosdaq_mket_lstg_dt`/`kosdaq_mket_lstg_abol_dt`로 기준일에 유효한 상장시장을 판별한다. 한 시장만 유효해야 한다. 두 시장 모두 유효하거나 확인되지 않으면 UNKNOWN이다. 기초지수가 코스닥150이라는 사실을 상장시장으로 사용하지 않는다.
- 신규 `instrumentType`, `classification` 필드는 기존 종목/신호 필드에 추가된다. classification에는 출처·버전·검증 기준일·증권그룹을 기록한다.

공식 구현·필드 목록:
- https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/search_stock_info/search_stock_info.py
- https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/search_stock_info/chk_search_stock_info.py

## 수집·표시·재사용

ETF·ETN은 상세 시세·수급 조회 전 제외한다. 모든 점수 함수는 공식 분류가 확인된 기업 주식만 받는다. 기존 가격·거래량·시장 지수 품질 및 점수 기준은 유지한다.

분류 또는 종목 상세 조회가 실패하면 성공 데이터로 발행하지 않는다. 현재 웹 파일과 두 trader 경로(`data/today/`, `data/`)의 신호를 failed/빈 배열로 바꾸고 비정상 종료하며, 해당 실패 결과를 히스토리에 기록하지 않는다. 이는 일부 후보 조회 실패로 불완전한 추천을 발행하는 것보다 가용성을 보수적으로 낮추는 정책이다. 후보별 기본정보 조회 1회가 추가되어 수집 시간이 늘어난다. 기존 KIS 직렬화·재시도 제한을 공유한다.

기관·외국인 목록이 비었을 때의 재사용 경로는 유지하되, 같은 기준일에 확인된 기업 주식만 재사용한다. 날짜가 다른 신호와 기존 무분류 신호는 재사용하지 않는다. 따라서 휴장일·오류 시 과거 신호를 새 날짜의 추천처럼 노출하던 동작은 제한된다.

화면은 동일한 분류 검사로 카드·탭 개수를 계산하고 전체/KOSPI/KOSDAQ 필터와 기업 주식 표시를 제공한다. 기존 무분류 JSON은 안전하게 읽되 미검증 추천을 표시하지 않는다. 최초 정상 수집 전에는 기존 신호가 화면에서 사라진다.

과거 아카이브와 today_signal.json을 이 PR에서 수정하거나 재생성하지 않는다. 원본 오류는 감사 증거로 남긴다. 운영 수집·자동매매·병합은 실행하지 않는다. 외부 kis-trader 저장소는 변경하지 않았으며 추가 필드 허용 여부는 운영 승인 전에 소비자 측에서도 확인해야 한다.

## 검증과 제한

`tests/instrument.test.ts`는 실제 2026-10-23·26 아카이브를 읽는다. 유니테크노 시장 정정 후 기존 거래량 점수를 유지하는지, Q530107 ETN 및 ETF 4개가 모든 점수 함수와 재사용/화면에서 제외되는지 확인한다. 미확인 응답·코드 불일치·상장 충돌·미래 상장·상장폐지도 검사한다.

기본정보 응답은 필드 계약을 재현한 테스트 데이터이며 실계좌 API 녹화본이 아니다. KIS 실조회/공식 응답의 그룹 코드 및 날짜 필드가 실제 운영 계정에서도 이 계약을 충족하는지는 아직 검증하지 않았다. 알 수 없는 응답은 추정하지 않고 신호 생성을 중단한다.
