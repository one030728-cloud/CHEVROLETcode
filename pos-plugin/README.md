# 쉐보레 포스모스 — 토스 POS 탭앱 (정비 대기열 관리)

토스 POS 화면에 탭으로 추가되어, 직원이 POS에서 바로 정비 대기열을 확인하고
순서 호출(알림톡 발송) / 정비완료 처리를 할 수 있는 플러그인입니다.
`backend/`가 이미 갖고 있는 예약/대기열 데이터를 그대로 사용합니다(별도 DB 없음).

[토스플레이스 "탭 화면(iframe) 패키지" 방식](https://docs.tossplace.com/guide/pos-integration/plugin/develop/iframe-package.html)으로
만들어졌고, `@tossplace/pos-plugin-sdk`의 `posPluginSdk.merchant.getMerchant()`로 매장을
자동 식별합니다(별도 로그인 없음) — 백엔드의 `requireStore` 미들웨어(merchantId 기반)와 짝을 이룹니다.

## 왜 버튼을 두 번 눌러야 하나요

"대기번호 #1을 실수로 탭했다고 바로 순서 호출 알림톡이 나가면 안 된다"는 요구사항 때문에,
`호출`/`완료` 버튼은 첫 번째 탭에서 "확정" 상태로만 바뀌고 3초 안에 같은 버튼을 한 번 더 눌러야
실제로 서버에 요청이 나갑니다(`src/app.js`의 `handleActionClick`/`confirming` 참고). 3초 안에
다시 누르지 않으면 원래 상태로 되돌아갑니다.

## 로컬 미리보기

```bash
cd pos-plugin
npm install
npm run build          # dist/ 생성 (index.html, iframe-manifest.json, bundle.js)
```

`backend`를 실행 중이면(`backend`의 `npm start`) `http://localhost:3000/pos-plugin/index.html`에서
바로 미리볼 수 있습니다(`backend/server.js`가 `pos-plugin/dist`를 정적 서빙). 로컬 미리보기에서는
`merchantId '0'` 테스트 매장으로 자동 동작합니다(`src/app.js`의 `isPreview` 분기).

## 배포 방식과 파일 구조

이 프로젝트는 토스 POS의 **탭 화면(iframe) 패키지 설치 방식**을 사용합니다. 따라서 공식 문서의
웹 워커/UMD 방식과 달리 `main.js`를 엔트리로 사용하지 않습니다.

```text
chevrolet-pos-plugin.zip
  index.html                 # iframe 화면 진입점
  iframe-manifest.json       # POS 탭 메타데이터
  bundle.js                  # src/app.js를 esbuild로 번들한 파일
```

`iframe-manifest.json`은 다음 세 필드를 사용합니다.

```json
{
  "tab": {
    "title": "정비 대기열",
    "description": "차량 정비 대기 손님을 확인하고 순서 호출/정비완료 처리를 합니다.",
    "href": "index.html"
  }
}
```

## 개발 배포 ZIP 만들기

```bash
cd pos-plugin
npm install
npm run zip       # build 후 chevrolet-pos-plugin.zip 생성
```

`npm run zip`은 먼저 `dist/`를 만들고, `dist/`의 실행 파일만 ZIP으로 묶습니다. 소스 코드,
`node_modules`, `.env`, 백엔드는 ZIP에 포함하지 않습니다.

## 실제 POS 단말기에 배포하려면 (사업자 계정 필요)

1. [토스플레이스 개발자센터](https://developers.tossplace.com/login)에서 **내 플러그인 → 플러그인 등록**을
   열고 타입을 `토스 POS`로 선택합니다. ACL에는 `https://chevroletcode.onrender.com`을 등록합니다.
2. 테스트 가맹점을 생성/연결하고, 해당 가맹점에서 이 플러그인 사용 여부를 켭니다.
3. 테스트 POS를 테스트 단말기로 등록합니다.
4. `npm run zip`으로 만든 `chevrolet-pos-plugin.zip`을
   **내 플러그인 → 개발 배포 → 개발용 파일 추가**에 업로드합니다.
5. POS 우측 상단 설정 → **다시 시작** 또는 새로고침으로 새 버전을 반영합니다.
6. 개발 배포는 검수 없이 최대 5개 단말기에서 확인할 수 있고, 전체 매장 배포는 검수 후
   라이브 배포가 필요합니다. 라이브 매장에서는 VAN 대리점의 플러그인 활성화도 필요합니다.
7. 문의: developer-support@tossplace.com

`main.js`가 반드시 필요한 것은 POS의 **스크립트 직접 로드(UMD/웹 워커) 방식**입니다.
그 방식은 DOM을 사용할 수 없으므로 현재처럼 대기열 UI를 제공하는 앱과 맞지 않습니다.
현재 구현을 UMD 방식으로 바꾸려면 별도 `main.js` 웹 워커 플러그인으로 다시 설계해야 하므로,
지금은 `iframe-manifest.json` + `index.html` + `bundle.js` 구조를 유지합니다.

공식 문서:

- [POS iframe 패키지 개발 가이드](https://docs.tossplace.com/guide/pos-integration/plugin/develop/iframe-package.html)
- [POS 플러그인 개발 튜토리얼](https://docs.tossplace.com/guide/pos-integration/plugin/develop/develop-tutorial.html)
- [POS UMD 방식(main.js) 가이드](https://docs.tossplace.com/guide/pos-integration/plugin/develop/umd.html)
- [POS 검수·배포 가이드](https://docs.tossplace.com/guide/pos-integration/plugin/deploy.html)

## 파일 구조

```
pos-plugin/
  build.js                   # esbuild로 src/app.js -> dist/bundle.js 번들 + public/* 복사
  public/
    index.html                # 탭 화면 셸(스타일 포함)
    iframe-manifest.json       # 탭 이름/설명/href (POS에 노출되는 탭 메타데이터)
  src/
    app.js                     # 대기열 조회/호출/완료 로직 (SDK + 백엔드 API 호출)
```

## 백엔드 API (merchantId 기반, 로그인 불필요)

`backend/server.js`에 추가된 전용 엔드포인트입니다. 관리자 대시보드(JWT)와는 별개로,
POS 탭앱은 `posPluginSdk.merchant.getMerchant()`가 준 merchantId만으로 동작합니다.

| 메서드/경로 | 설명 |
| --- | --- |
| `GET /api/pos/queue?merchantId=` | 정비완료 안 된(대기중/호출됨/알림실패) 예약을 대기번호순으로 조회 |
| `POST /api/pos/queue/:id/call` (body: `merchantId`) | 특정 예약 호출 (waiting 상태만 가능) |
| `POST /api/pos/queue/:id/complete` (body: `merchantId`) | 정비완료 처리 |
