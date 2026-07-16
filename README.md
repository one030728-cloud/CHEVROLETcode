# 쉐보레 토스플러그인 (예약 알림톡)

캐치테이블 스타일의 예약 플러그인. 방문자가 차량번호 → 전화번호를 입력하면
솔라피(Solapi)를 통해 카카오 알림톡을 발송합니다.

프론트엔드는 `backend/public`에 정적 파일로 두고, 백엔드(Express)가 그대로 서빙합니다.
별도 프론트 서버 없이 백엔드 하나만 배포하면 프론트/백엔드가 같이 뜹니다.

- 저장소: https://github.com/one030728-cloud/CHEVROLETcode
- 배포 주소: https://chevroletcode.onrender.com

## 새 컴퓨터에서 시작하기

```bash
git clone https://github.com/one030728-cloud/CHEVROLETcode.git
cd CHEVROLETcode/backend
npm install
cp .env.example .env   # 값은 비워둬도 서버는 뜹니다 (알림톡 발송만 실패, 예약 접수는 정상 처리됨)
npm start
```

`http://localhost:3000` 접속해서 차량번호 → 전화번호 2단계 폼이 뜨는지 확인하면 정상입니다.

필요한 것: Node.js 18 이상. 그 외 별도 DB/외부 서비스 계정 없이도 로컬 실행과 예약 접수 테스트가 됩니다
(알림톡 발송만 솔라피 키가 있어야 실제로 나감).

## 폴더 구조

```
backend/
  server.js       # Express 서버, POST /api/reservations
  src/solapi.js    # 알림톡 발송 함수 (변수: #{차량번호}, #{전화번호})
  src/store.js      # 임시 인메모리 저장소 (서버 재시작하면 데이터 사라짐, 아래 "현재 상태" 참고)
  public/           # 프론트엔드 정적 파일 (index.html, reservation.js, styles.css)
```

## 현재 상태 (이어서 작업할 때 꼭 읽기)

- **DB 없음.** 예약 기록은 `src/store.js`의 인메모리 배열에만 저장됩니다. 서버 재시작/재배포 시 전부 사라집니다.
  DB(Supabase 등) 연결 시 `createReservation`, `listReservations` 함수 시그니처만 유지한 채 내부 구현을 바꾸면 됩니다.
- **솔라피 키 미발급.** `.env`의 `SOLAPI_*` 값이 전부 비어 있어도 예약 접수 API는 정상 동작하고,
  알림톡 발송만 실패 로그(`알림톡 발송 실패: ...`)를 남기고 넘어갑니다 (요청 자체는 실패시키지 않음, `server.js`의 catch 블록 참고).
- **관리자 화면 없음.** 예약 목록을 조회하는 화면/엔드포인트가 아직 없습니다. 전화번호가 개인정보이므로
  나중에 만들 때 반드시 인증을 붙여야 합니다 (인증 없이 GET 엔드포인트로 노출 금지).
- **로컬 검증 완료.** 차번호(`12가3456`) → 전화번호(`010-1234-5678`) 입력 → 제출 → 완료 화면까지 브라우저로 확인함.

## 알림톡 템플릿 변수

- `#{차량번호}` — 예) 12가3456
- `#{전화번호}` — 하이픈 없는 숫자만

솔라피에서 템플릿 승인받은 후 `.env`에 아래 값을 채우세요.

```
SOLAPI_API_KEY=
SOLAPI_API_SECRET=
SOLAPI_SENDER=          # 발신번호 (사전등록 필요)
SOLAPI_KAKAO_PFID=      # 카카오 채널 pfId
SOLAPI_KAKAO_TEMPLATE_RESERVATION=  # 승인된 템플릿 ID
```

## Render 배포

이미 https://chevroletcode.onrender.com 에 연결되어 있습니다. 새로 설정할 경우:

1. Render → New → Web Service → 이 저장소(`one030728-cloud/CHEVROLETcode`) 연결
2. Root Directory: `backend`
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Environment 탭에서 위 `SOLAPI_*` 키들을 등록
6. `main` 브랜치에 push하면 Render가 자동 재배포합니다 (Auto-Deploy 켜져 있는 경우)

## 다음 단계 (TODO)

- [ ] 솔라피 알림톡 키/템플릿 발급받아 Render Environment와 로컬 `.env`에 채우기
- [ ] `src/store.js`를 실제 DB(Supabase 등)로 교체
- [ ] 관리자용 예약 목록 조회 화면 (인증 필요)
