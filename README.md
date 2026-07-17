# 🚗 쉐보레 포스모스 — 토스플레이스 예약·결제 플러그인

![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/express-4.x-000000?logo=express&logoColor=white)
![Deploy](https://img.shields.io/badge/deploy-Render-46E3B7?logo=render&logoColor=white)
![Status](https://img.shields.io/badge/status-active-brightgreen)
![License](https://img.shields.io/badge/license-Private-lightgrey)

캐치테이블 스타일의 차량 정비 예약 · 대기열 호출 · 결제 전자영수증 알림톡 플러그인입니다.
매장에 설치된 **토스프론트 결제 단말기**에서 실제로 동작하는 Front Plugin과, 브라우저 어디서나 접속 가능한
**독립 웹페이지** 두 가지 형태로 제공됩니다.

- 🔗 저장소: https://github.com/one030728-cloud/CHEVROLETcode
- 🌐 배포 주소: https://chevroletcode.onrender.com

## 목차

- [개요](#개요)
- [주요 기능](#주요-기능)
- [빠른 시작](#빠른-시작)
- [프로젝트 구조](#프로젝트-구조)
- [API](#api)
- [토스프론트 플러그인 연동](#토스프론트-플러그인-연동)
- [환경 변수 / 알림톡 설정](#환경-변수--알림톡-설정)
- [Render 배포](#render-배포)
- [알려진 제한사항 & 다음 단계](#알려진-제한사항--다음-단계)

## 개요

백엔드(Express) 하나가 두 프론트를 함께 서빙합니다.

| 버전 | 경로 | 설명 |
| --- | --- | --- |
| 독립 웹페이지 | `backend/public/index.html` (`?mode=payment`) | 브라우저 어디서나 접속 가능한 범용 버전 |
| 토스프론트 플러그인 | `backend/public/toss-plugin/` | 매장 단말기(토스프론트)에서 실행되는 실제 플러그인. [토스플레이스 Front SDK](https://docs.tossplace.com/)의 Template API(`sdk.template.renderXxxPage`)와 결제 API(`sdk.payment.requestPayment`) 사용 |

자세한 내용은 [토스프론트 플러그인 연동](#토스프론트-플러그인-연동) 섹션 참고.

## 주요 기능

- **예약 접수 + 실시간 대기 안내** — 차량번호 → 정비 항목(엔진오일 교체/정기점검/타이어 교체·펑크수리/배터리 교체/브레이크 정비/기타 수리·상담) → 전화번호 입력만으로 대기번호 발급
- **스마트 자동 호출** — 앞서 정비완료 처리가 안 된 예약이 없으면 즉시 "고객님의 순서입니다" 알림톡 발송, 있으면 "앞으로 N명 남았습니다" 접수 안내
- **정비완료 기반 대기열** — 알림톡 발송 여부가 아니라 관리자가 직접 처리하는 "정비완료" 상태로 대기인원을 계산해 실제 매장 상황을 반영
- **결제 즉시 전자영수증** — 결제 화면에서 차량번호를 다시 입력받지 않고, 전화번호로 예약 기록을 조회해 차량번호·정비항목을 자동으로 매칭
- **3개월 후 자동 프로모션 알림톡** — 매일 오전 10시 스케줄러가 결제일 기준 대상자 확인 후 발송
- **관리자 대시보드** (`/admin.html`) — 예약/결제 전체 조회, 특정 예약 즉시 호출·정비완료·삭제, 테스트 예약 생성
- **카카오 알림톡 → SMS 자동 폴백** — 채널/템플릿 승인 전에도 일반 문자로 즉시 테스트 가능

## 빠른 시작

```bash
git clone https://github.com/one030728-cloud/CHEVROLETcode.git
cd CHEVROLETcode/backend
npm install
cp .env.example .env   # 값은 비워둬도 서버는 뜹니다 (알림톡 발송만 실패, 예약/결제 접수는 정상 처리됨)
npm start
```

필요한 것은 **Node.js 18 이상**뿐입니다. 별도 DB/외부 서비스 계정 없이도 로컬에서 예약·결제 접수 흐름을 바로 테스트할 수 있습니다
(알림톡 발송만 솔라피 키가 있어야 실제로 나갑니다).

| 접속 주소 | 내용 |
| --- | --- |
| `http://localhost:3000` | 독립 웹페이지 — 차량번호 → 전화번호 예약 폼 |
| `http://localhost:3000/?mode=payment` | 독립 웹페이지 — 결제(영수증) 모드 |
| `http://localhost:3000/toss-plugin/index.html` | 토스프론트 플러그인 화면을 브라우저에서 미리보기 |
| `http://localhost:3000/admin.html` | 관리자 대시보드 (`ADMIN_TOKEN` 필요) |

## 프로젝트 구조

```
backend/
  server.js               # Express 서버 (예약/결제 API, 대기순번 호출, 3개월 프로모션 스케줄러)
  src/
    solapi.js              # 알림톡 발송 함수 (예약안내/순서호출/영수증/프로모션 템플릿별로 분리)
    store.js                # 임시 인메모리 저장소 (서버 재시작하면 데이터 사라짐)
  public/
    index.html, reservation.js, styles.css   # 독립 웹페이지 버전 (?mode=payment로 결제 모드)
    admin.html                                # 관리자 대시보드
    toss-plugin/                              # 토스프론트 플러그인
      index.html         # 대기화면 (예약하기/결제하기 2버튼)
      reservation.html    # 차량번호 → 정비항목 → 전화번호 → 대기번호 (Template API)
      payment.html         # 금액입력 → 실제 결제(sdk.payment) → 전화번호 → 영수증
      onboarding.html, settings.html, sdk.js   # 템플릿 요구 파일 (자세한 설명은 파일 내 주석)
```

## API

| 메서드/경로 | 설명 | 인증 |
| --- | --- | --- |
| `POST /api/reservations` | 차량번호+정비항목(`serviceType`)+전화번호 등록, 대기번호 발급. 앞서 정비완료 안 된 예약이 없으면 즉시 순서 호출 알림톡, 있으면 "N명 남았습니다" 접수 알림톡 발송 | 없음 (10분당 5회 레이트리밋) |
| `GET /api/reservations` | 예약 전체 목록 조회 (관리자 화면용, 최신순) | `x-admin-token` |
| `POST /api/queue/call-next` | 대기열 맨 앞(`waiting`) 손님을 호출, "순서입니다" 알림톡 발송 | `x-admin-token` |
| `POST /api/reservations/:id/call` | 특정 예약을 순서와 무관하게 즉시 호출 (`waiting` 상태만 가능) | `x-admin-token` |
| `POST /api/reservations/:id/complete` | 정비완료 처리. 이후 예약들의 "앞사람" 계산에서 빠짐 | `x-admin-token` |
| `DELETE /api/reservations/:id` | 예약 삭제 (테스트 데이터 정리, 취소 처리용) | `x-admin-token` |
| `GET /api/reservations/failed` | 순서/접수 알림톡 발송 실패 건 조회 | `x-admin-token` |
| `POST /api/payments` | 전화번호(+금액/paymentKey) 등록. 차량번호/정비항목은 그 전화번호로 등록된 예약 기록에서 자동으로 가져옴(없으면 클라이언트가 보낸 `carNumber`로 대체). 전자영수증 즉시 발송, 3개월 후 프로모션 예약 | 없음 (10분당 10회 레이트리밋) |
| `GET /api/payments` | 결제 전체 목록 조회 (관리자 화면용, 최신순) | `x-admin-token` |
| `GET /api/payments/failed` | 전자영수증 발송 실패 건 조회 | `x-admin-token` |

<details>
<summary>세부 동작 참고</summary>

- `serviceType`은 `엔진오일 교체`/`정기점검`/`타이어 교체·펑크수리`/`배터리 교체`/`브레이크 정비`/`기타 수리·상담` 중 하나를 가리키는 키
  (`oil`/`inspection`/`tire`/`battery`/`brake`/`etc`)입니다. 서버([server.js](backend/server.js)의 `SERVICE_TYPES`), 토스프론트 예약 화면
  ([toss-plugin/reservation.html](backend/public/toss-plugin/reservation.html)), 관리자 페이지([admin.html](backend/public/admin.html)) 세 군데에
  같은 목록이 하드코딩돼 있어서, 항목을 추가/변경할 땐 세 파일을 함께 고쳐야 합니다.
- 관리자 페이지(`/admin.html`)에는 실제 손님 없이 예약을 넣어볼 수 있는 "테스트 예약 생성" 폼이 있습니다 — 대기인원 안내 문자나
  자동 호출 동작을 확인할 때 씁니다.
- `POST /api/payments`에 `paymentKey`(토스프론트에서 `sdk.payment.requestPayment()` 호출 시 발급한 값)를 같이 보내면,
  같은 `paymentKey`로 재요청해도 기존 레코드를 그대로 반환합니다 (영수증 중복 발송 방지, 결제 화면 네트워크 재시도 대비).
- 알림톡을 보냈다고 자동으로 대기열 "앞사람"에서 빠지는 게 아닙니다 — 정비가 실제로 끝나면 관리자 페이지에서 그 예약의
  "완료" 버튼을 눌러야(`POST /api/reservations/:id/complete`) 다음 예약이 "앞에 아무도 없음"으로 계산됩니다.
- 결제 화면에서 차량번호를 다시 입력받지 않는 대신, 전화번호로 `findLatestReservationByPhone`가 그 손님의 예약 기록을 찾습니다
  (같은 날 예약을 우선하고, 없으면 그 번호로 등록된 가장 최근 예약을 사용). 예약 없이 바로 결제하러 온 손님은 매칭되는 기록이 없어
  차량번호/정비항목 없이 영수증이 나갑니다.

</details>

## 토스프론트 플러그인 연동

`backend/public/toss-plugin/`이 실제 토스 결제 단말기(토스프론트)에서 돌아가는 플러그인입니다.
[토스플레이스 연동 가이드](https://docs.tossplace.com/)를 확인해서 아래 구조로 만들었습니다.

- CDN에서 `https://cdn.tossplace.com/toss-front-sdk/v0/index.js`를 불러오면 전역 `window.TossFrontSDK`가 생깁니다.
- 화면은 반드시 SDK가 제공하는 **Template API**(`sdk.template.renderIdlePage`, `renderInputPage`, `renderSelectPage`, `renderResultPage` 등)로만
  구성해야 합니다. 심사 때 이 부분을 확인한다고 안내되어 있어서, 이 플러그인의 자유 형식 HTML/CSS(`public/index.html` 쪽)는
  토스프론트 안에서는 그대로 못 쓰고 Template API로 다시 짰습니다.
- 실제 결제는 `sdk.payment.requestPayment({ paymentKey, tax, supplyValue, tip })`로 단말기가 직접 처리합니다.
  이 저장소의 Express 백엔드는 결제 자체를 처리하지 않고, 결제 성공 후 수집한 전화번호로 영수증 알림톡을 보내고
  DB에 적재하는 역할만 합니다.
- 파일별 역할은 `sdk.js`(로컬 개발용 가맹점 정보 오버라이드), `index.html`(대기화면), `reservation.html`(예약),
  `payment.html`(결제+영수증), `onboarding.html`/`settings.html`(템플릿이 요구하는 표준 파일, 이 매장은 단일 매장이라
  실질적인 로그인/설정 로직은 없고 파일 안 주석에 이유를 적어뒀습니다)로 나뉩니다.

### 로컬 미리보기

`npm start` 후 `http://localhost:3000/toss-plugin/index.html`으로 접속하면 단말기 없이 브라우저에서 확인할 수 있습니다
(토스 문서에도 "기본 개발은 단말기 없이 브라우저로 가능"하다고 나와 있음). 예약 흐름(차량번호→정비항목→전화번호→대기번호)과
결제 흐름(금액입력→결제수단선택→전화번호→영수증)을 브라우저로 직접 클릭해서 끝까지 확인했고, 실제로 백엔드에
`POST /api/reservations`, `POST /api/payments`가 정상 호출되어 대기번호/영수증 상태까지 저장되는 것을 확인했습니다.

### 실제 단말기에 배포하려면 (사업자 계정 필요)

토스플레이스 개발자센터는 사업자 계정으로 로그인해야 해서 대신 진행할 수 없는 단계입니다. 문서 기준 절차는 다음과 같습니다.

1. [토스플레이스 개발자센터](https://developers.tossplace.com/login)에 로그인 → **내 플러그인 → 플러그인 등록**,
   타입은 "토스프론트"로 선택 (플러그인 이름/ID/회사명/ACL 입력)
2. 등록하면 예제 기반 기본 플러그인이 자동 생성됨 (이 저장소의 `toss-plugin/` 코드로 교체할 부분)
3. **테스트 가맹점 관리**에서 기존 테스트 가맹점 선택 또는 신규 생성 → 매장고유번호/사업자번호/휴대폰번호 발급
4. 테스트 가맹점 상세화면에서 이 플러그인 사용 여부를 켬
5. 실제 토스프론트 단말기(또는 테스트 단말기)에서 사업자번호/매장고유번호/휴대폰번호로 온보딩
6. 코드 수정 후 `backend/public/toss-plugin/` **폴더 안 내용물만** ZIP으로 압축 (`index.html`이 zip 최상위에 와야 함) →
   개발자센터 **내 플러그인 → 개발 배포 → 개발용 파일 추가** → **배포** 클릭
   (개발 배포는 검수 없이 최대 5개 단말기까지 즉시 반영, 전체 단말기 반영은 검수 후 **라이브 배포**)
7. 문의사항은 developer-support@tossplace.com

> ⚠️ 프로젝트 전체(`server.js`, `.env`, `public/index.html` 등)를 통째로 압축하면 안 됩니다 — 단말기가 진짜 플러그인
> 화면(Template API) 대신 독립 웹페이지를 잘못 로드해 키보드 겹침 등 예상치 못한 문제가 생깁니다.

<details>
<summary>결제 완료를 서버에서 더 확실하게 받으려면 (선택, 계정/문의 필요)</summary>

토스플레이스는 결제 승인/취소 시 **웹훅**(`payment.payment.approved.v1`, `payment.payment.cancelled.v1`)을 지원합니다
([Open API 문서](https://docs.tossplace.com/reference/open-api/webhook.html)). 지금 구현은 `payment.html`이 결제 성공 후
클라이언트에서 직접 `/api/payments`를 호출하는 방식인데, 만약 이 호출이 네트워크 문제로 실패하면 결제는 됐는데 영수증/DB
적재가 안 되는 경우가 생길 수 있습니다. 웹훅을 받으면 이런 누락을 서버 쪽에서 보완할 수 있는데, **웹훅 등록은 개발자센터에서
자체적으로 설정할 수 없고 토스플레이스 담당자에게 별도로 문의해서 설정해야 한다**고 문서에 나와 있습니다
(수신 주소/이벤트 범위를 담당자가 등록, `x-toss-signature`로 위변조 검증, `x-toss-webhook-id`로 중복 수신 방지 필요).
지금 당장은 클라이언트 호출 방식만으로도 동작하니, 필요할 때 담당자 문의 후 웹훅 수신 엔드포인트를 추가하면 됩니다.

</details>

## 환경 변수 / 알림톡 설정

```env
PORT=3000

# 솔라피 (알림톡)
SOLAPI_API_KEY=
SOLAPI_API_SECRET=
SOLAPI_SENDER=                       # 발신번호 (사전등록 필요)
SOLAPI_KAKAO_PFID=                   # 카카오 채널 pfId
SOLAPI_KAKAO_TEMPLATE_RESERVATION=   # 예약 접수 안내 (대기인원 있을 때)
SOLAPI_KAKAO_TEMPLATE_QUEUE_TURN=    # "고객님의 순서입니다" 순서 호출
SOLAPI_KAKAO_TEMPLATE_RECEIPT=       # 결제 전자영수증
SOLAPI_KAKAO_TEMPLATE_PROMO=         # 결제 3개월 후 홍보

# 관리자 API(대시보드, 호출/완료/삭제, 실패건 조회)용 토큰. 임의의 긴 랜덤 문자열로 설정.
ADMIN_TOKEN=
```

카카오 알림톡은 채널 개설 + 템플릿 승인이 필요해서 보통 1~3영업일이 걸립니다. `SOLAPI_KAKAO_PFID`와 각 템플릿 ID가
비어 있으면 자동으로 **일반 문자(SMS)**로 대신 보내도록 되어 있어서, 승인을 기다리지 않고도 바로 전체 흐름을 테스트할 수 있습니다.

<details>
<summary>카카오 알림톡 승인 전, 일반 문자로 먼저 테스트하기</summary>

1. [솔라피](https://solapi.com) 가입
2. 콘솔 → API Key 관리에서 `SOLAPI_API_KEY`/`SOLAPI_API_SECRET` 발급
3. 콘솔 → 발신번호 관리에서 본인 번호를 발신번호로 등록(본인인증) → `SOLAPI_SENDER`에 입력
4. 계정에 소액 충전 (문자는 건당 과금)
5. `.env`에 위 세 값만 채우고(카카오 관련 값은 비워둠) 서버 재시작 → 예약/결제 시 일반 문자로 발송됨

나중에 카카오 채널/템플릿이 승인되면 `SOLAPI_KAKAO_PFID`와 템플릿 ID들을 채우기만 하면 코드 변경 없이
자동으로 알림톡 발송으로 전환됩니다.

</details>

<details>
<summary>알림톡 템플릿 변수</summary>

| 변수 | 설명 |
| --- | --- |
| `#{차량번호}` | 예) 12가3456 |
| `#{전화번호}` | 하이픈 없는 숫자만 |
| `#{대기번호}` | 예약 순번 (예약/순서호출 템플릿) |
| `#{대기인원}` | 내 앞에 대기중인 인원수 (예약 접수 템플릿 전용, 대기중인 손님이 있을 때만 발송됨) |
| `#{정비항목}` | 예약 시 선택한 정비 종류 (예: 엔진오일 교체). 예약 접수/순서호출/영수증 템플릿에서 사용. 영수증에서는 전화번호로 찾은 예약 기록에서 가져오며, 매칭되는 예약이 없으면 빈 값 |
| `#{결제금액}` | 예) "15,000원" (영수증 템플릿) |

</details>

## Render 배포

이미 https://chevroletcode.onrender.com 에 연결되어 있습니다. 새로 설정할 경우:

1. Render → New → Web Service → 이 저장소(`one030728-cloud/CHEVROLETcode`) 연결
2. Root Directory: `backend`
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Environment 탭에서 위 `SOLAPI_*`, `ADMIN_TOKEN` 키들을 등록
6. `main` 브랜치에 push하면 Render가 자동 재배포합니다 (Auto-Deploy 켜져 있는 경우)

> ⚠️ Render 무료 플랜은 트래픽이 없으면 슬립 상태가 되어 오전 10시 프로모션 스케줄러가 안 돌 수 있습니다.
> 이 문제를 없애려면 유료 플랜(항상 켜짐) 또는 외부 크론(예: cron-job.org가 `/healthz`를 주기적으로 호출)이 필요합니다.

## 알려진 제한사항 & 다음 단계

<details open>
<summary><strong>현재 상태</strong></summary>

- **DB 없음.** 예약/결제 기록은 `src/store.js`의 인메모리 배열에만 저장됩니다. 서버 재시작/재배포 시 전부 사라집니다.
  특히 결제 기록의 `promoAt`(3개월 후 발송 예정 시각)이 재시작으로 유실되면 홍보 알림톡이 영구히 안 나가므로,
  DB(Supabase 등) 교체가 최우선입니다. 교체 시 `src/store.js`의 함수 시그니처만 유지한 채 내부 구현을 바꾸면 됩니다.
- **솔라피 키 미발급.** `.env`의 `SOLAPI_*` 값이 전부 비어 있어도 예약/결제 접수 API는 정상 동작하고,
  알림톡 발송만 실패 로그를 남기고 넘어갑니다 (요청 자체는 실패시키지 않음).
- **3개월 프로모션 스케줄러는 `node-cron`으로 매일 10시 실행.** 서버가 그 시각에 떠 있지 않으면(예: 무료 플랜 슬립) 그날은 건너뛰지만,
  다음 실행 때 `promoAt`이 이미 지난 건은 다시 잡혀서 발송 시도합니다 (재시도 자체는 됨, 정시 발송은 보장 안 됨).
- **레이트리밋 적용됨.** `POST /api/reservations`는 IP당 10분에 5회, `POST /api/payments`는 10분에 10회로 제한됩니다.
- **토스프론트 플러그인은 아직 실제 계정에 배포 안 됨.** 코드는 완성됐지만, 토스플레이스 개발자센터 플러그인 등록·테스트
  가맹점 연결·단말기 온보딩·ZIP 배포는 사업자 계정 로그인이 필요해서 사용자가 직접 진행해야 합니다.

</details>

**TODO**

- [ ] 솔라피 알림톡 키/템플릿 4종 발급받아 Render Environment와 로컬 `.env`에 채우기
- [ ] `src/store.js`를 실제 DB(Supabase 등)로 교체 — 3개월 프로모션 예약이 서버 재시작에도 살아남도록 하는 게 최우선
- [ ] Render Environment에 `ADMIN_TOKEN` 값 등록 (긴 랜덤 문자열, 아직 미발급)
- [ ] Render 무료 플랜 슬립으로 인한 프로모션 스케줄러 미실행 문제 해결 (유료 플랜 또는 외부 핑)
- [ ] **토스플레이스 개발자센터에서 실제 플러그인 등록·테스트 가맹점 연결·단말기 온보딩** (사업자 계정 필요, [토스프론트 플러그인 연동](#토스프론트-플러그인-연동) 섹션 절차대로)
- [ ] `toss-plugin/` 폴더 ZIP 압축 후 개발 배포 → 실제 단말기에서 화면/결제 흐름 확인
- [ ] (선택) 결제 승인 웹훅 수신이 필요하면 developer-support@tossplace.com에 문의해서 웹훅 등록
