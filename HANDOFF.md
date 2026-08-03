# 작업 인수인계 (Claude → Codex)

이 문서는 토큰 소진 전에 다음 작업자가 이어받을 수 있도록 현재 상태를 정리한 것입니다.
읽고 나면 삭제해도 되고, 계속 갱신해도 됩니다.

## 지금 진행 중이던 작업

**목표**: 토스 탭앱(POS)/프론트앱(Front)을 별도 프로젝트 폴더로 분리하고, 셋(백엔드/프론트앱/탭앱)이
서로 정상 연동되는지(서버 API + DB 공유) 확인하는 것.

**진행 상황**:
1. ✅ `front-plugin/`은 웹 프론트엔드가 아니라 `toss-front-sdk`를 사용하는 **토스프론트 단말기용**
   플러그인으로 분리되어 있음.
2. ✅ `pos-plugin/`은 `@tossplace/pos-plugin-sdk`를 사용하는 **토스 POS 탭 화면(iframe)** 플러그인으로
   분리되어 있음.
3. ✅ `backend/server.js`가 두 플러그인을 로컬 미리보기용으로 정적 서빙함 (`/toss-plugin` → `front-plugin/`,
   `/pos-plugin` → `pos-plugin/dist/`). 운영 배포 시에는 두 ZIP을 개발자센터에 각각 업로드함.
4. ✅ README 경로 참조와 `front-plugin/README.md`를 정리함.
5. ✅ 공식 문서 대조 완료. POS iframe 매니페스트에 `tab.href: "index.html"`를 추가함.
6. ✅ `front-plugin/npm run zip`, `pos-plugin/npm run zip` 배포 패키징 명령을 추가함.
7. 🔶 통합 API 검증은 서버/정적 경로까지 확인했으며, 테스트 예약 생성 요청은 PowerShell의 한글 JSON
   인코딩 문제로 400을 받아 중단됨. 다음 작업에서 JSON Unicode escape 방식으로 재시도할 것.

## 현재 최종 폴더 구조

```
CHEVROLETcode-main/
  backend/                  # 공유 Express 서버 + Prisma/SQLite DB (전부 여기 하나)
    server.js               # API 전부 + front-plugin/pos-plugin 정적 서빙
    src/{store.js, auth.js, solapi.js}
    prisma/schema.prisma
    public/{index.html, reservation.js, styles.css, admin.html}   # 독립 웹페이지 + 관리자 대시보드
  front-plugin/              # 토스프론트 플러그인 (독립 폴더, 빌드 불필요, 순수 HTML/JS)
    index.html, reservation.html, payment.html, onboarding.html, settings.html, sdk.js
    package.json, package.ps1  # chevrolet-front-plugin.zip 생성
  pos-plugin/                # 토스 POS 탭앱 (독립 폴더, esbuild 빌드 필요)
    package.json, build.js, package.ps1, src/app.js
    public/{index.html, iframe-manifest.json}  # tab.href=index.html
    README.md                # 빌드/ZIP/배포 절차 문서화됨
  docs/                      # 과거 아키텍처 리뷰 문서 (옛 경로 언급 있음 — 역사적 기록이라 그대로 둬도 됨)
  HANDOFF.md                 # 이 파일
```

## 재검증 방법

```bash
cd backend
npm install          # 처음이면
cp .env.example .env
npx prisma generate
npx prisma migrate deploy
PORT=3001 node server.js
```

배포 ZIP도 먼저 생성합니다.

```bash
cd ../front-plugin && npm run zip
cd ../pos-plugin && npm install && npm run zip
```

브라우저로 확인:
- `http://localhost:3001/toss-plugin/index.html` → 예약/결제 화면이 뜨는지 (front-plugin 정적 서빙 확인)
- `http://localhost:3001/pos-plugin/index.html` → 대기열 탭이 뜨는지 (pos-plugin/dist 정적 서빙 확인,
  먼저 `cd pos-plugin && npm install && npm run build` 필요)
- `http://localhost:3001/admin.html` → 관리자 대시보드 로그인 (부팅 로그에 hq_admin 임시 비밀번호 출력됨)

연동 확인 시나리오 (셋이 같은 DB를 공유하는지):
1. `front-plugin`(`/toss-plugin/reservation.html`)에서 예약 접수 (merchantId=0 자동, 로컬 미리보기 오버라이드)
2. `pos-plugin`(`/pos-plugin/index.html`)에서 그 예약이 대기열에 뜨는지 확인
3. POS에서 "호출" 버튼 두 번 탭(2단계 확인) → 상태가 `called`/`notify_failed`로 바뀌는지 확인
4. POS에서 "완료" 버튼 두 번 탭 → 해당 예약이 대기열에서 사라지는지 확인
5. `admin.html`에서 같은 예약의 상태를 확인 (JWT 로그인 필요)

공식 배포 방식:
- Front: 전체 파일 ZIP → 개발자센터에서 타입 `토스프론트` 선택 → 테스트 프론트 등록 → 업로드/배포 →
  프론트 설정 `7055`에서 업데이트 또는 재시작.
- POS iframe: `npm run build` → `dist/` ZIP(`index.html`, `iframe-manifest.json`, `bundle.js`) →
  개발자센터에서 타입 `토스 POS` 선택 → 테스트 POS 등록 → 업로드/배포 → POS 재시작.
- POS UMD 방식의 `main.js`는 현재 구현에 사용하지 않음. 현재 화면 UI에는 iframe 방식이 맞음.

## 이번 세션에서 이미 완료된 주요 수정사항 (배경 지식)

- 독립 웹페이지(`backend/public/index.html`)가 `merchantId`를 안 보내던 버그 수정 → URL 쿼리
  (`?merchantId=xxx`)로 받도록 함. **플러그인이 이 페이지를 탭앱으로 띄울 때 반드시 merchantId를
  쿼리에 넣어줘야 함.**
- `express-rate-limit` trust proxy 미설정 문제 수정 → `TRUST_PROXY_HOPS` 환경변수 추가(기본 1).
  Render든 GCP든 로드밸런서 홉 수에 맞춰 이 값만 조정하면 됨.
- 대기번호/오늘 예약 매칭이 UTC 자정 기준이던 버그 수정 → KST(한국시간) 자정 기준으로 변경
  (`backend/src/store.js`의 `kstDateString`/`kstDayStartUtc`).
- 대기인원(`peopleAhead`) 계산의 race condition 수정 → `createReservation`을 Prisma 트랜잭션
  하나로 묶음 (카운트→채번→생성 원자적 처리).
- `pos-plugin/` 신규 생성: `@tossplace/pos-plugin-sdk` 기반, `posPluginSdk.merchant.getMerchant()`로
  매장 자동 식별, 호출/완료 버튼은 3초 내 재확인(2단계 탭) 방식으로 오탭 방지.
- 백엔드에 `/api/pos/queue`(GET), `/api/pos/queue/:id/call`(POST), `/api/pos/queue/:id/complete`(POST)
  3개 엔드포인트 추가 (merchantId 기반, JWT 로그인 불필요 — 기존 예약/결제 API와 같은 신뢰 모델).

## 사용자(han)의 향후 계획/맥락

- 이 프로젝트는 나중에 **GCP로 호스팅 이전 예정**. `TRUST_PROXY_HOPS` 값만 실제 프록시 구성에
  맞춰 재확인하면 되고, 나머지 코드는 플랫폼 비종속적.
- POS 탭앱의 핵심 요구사항은 "**대기번호를 탭한다고 바로 호출되면 안 된다**"는 것이었음 —
  이미 2단계 확인(3초 내 재탭)으로 구현/검증 완료.
- 사용자는 한국어로 대화하며, 진행 중 방향을 바꾸는 질문(AskUserQuestion)에 신속하고 짧게 답하는 편.
