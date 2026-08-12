# Today Signal

기관·외국인 수급과 거래량, 시장 흐름을 조합해 국내 주식의 일일 관찰 신호를 보여주는 대시보드입니다.

[서비스 바로가기](https://bsjuun2026.mycafe24.com/todaysignal/)

## 주요 기능

- 기관 순매수, 외국인 매집, 거래량 급등, 강한 수급 신호 분류
- 종목별 점수·등급과 신호 산출 근거 표시
- KOSPI·KOSDAQ 급락 시 신호를 억제하는 시장 안전장치
- 목표 수익과 손절 기준을 계산하는 간단한 수익 계산기
- 이전 거래일 신호의 성과 검증 및 이력 저장
- 데이터 수집, 정적 빌드, Cafe24 배포 자동화

## 기술 스택

- Next.js 16 / React 19 / TypeScript
- Tailwind CSS 4
- 한국투자증권 Open API
- GitHub Actions / Cafe24 FTP

## 로컬 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

## 주요 명령어

```bash
npm run data:update    # 최신 수급·시장 데이터 수집
npm run short:balance  # 공매도 잔고 데이터 수집
npm run data:verify    # 과거 신호 성과 검증
npm run build          # 정적 사이트 빌드
```

실데이터 수집에는 `KIS_APP_KEY`, `KIS_APP_SECRET` 등 별도의 환경 변수가 필요합니다.

## 안내

표시되는 신호는 기술적 조건을 기준으로 생성된 참고 정보이며 투자 권유가 아닙니다.
