# 쉐보레 토스플러그인 (예약 알림톡)

캐치테이블 스타일의 예약 플러그인. 방문자가 차량번호 → 전화번호를 입력하면
솔라피(Solapi)를 통해 카카오 알림톡을 발송합니다.

프론트엔드는 `backend/public`에 정적 파일로 두고, 백엔드(Express)가 그대로 서빙합니다.
Render에 백엔드 한 개만 배포하면 프론트/백엔드가 같이 뜹니다.

## 로컬 실행

```bash
cd backend
npm install
cp .env.example .env   # 값은 아직 비워둬도 됩니다 (알림톡 발송만 실패, 예약 접수는 정상)
npm start
```

`http://localhost:3000` 접속.

## 폴더 구조

```
backend/
  server.js          # Express 서버, POST /api/reservations
  src/solapi.js       # 알림톡 발송 함수 (변수: #{차량번호}, #{전화번호})
  src/store.js         # 임시 인메모리 저장소 (나중에 DB로 교체 예정)
  public/              # 프론트엔드 (차번호 → 전화번호 2단계 폼)
```

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

- 저장소: https://github.com/one030728-cloud/CHEVROLETcode
- 배포 주소: https://chevroletcode.onrender.com

1. 이 저장소를 GitHub에 push
2. Render → New → Web Service → 저장소 연결
3. Root Directory: `backend`
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Environment 탭에서 위 `.env.example`의 키들을 등록
7. 배포 후 https://chevroletcode.onrender.com 접속하면 예약 폼이 바로 뜹니다

## 다음 단계 (TODO)

- [ ] 솔라피 알림톡 키/템플릿 발급받아 `.env`에 채우기
- [ ] `src/store.js`를 실제 DB(Supabase 등)로 교체 — 함수 시그니처(`createReservation`, `listReservations`)는 유지한 채 내부 구현만 바꾸면 됨
- [ ] 관리자용 예약 목록 조회 화면 (인증 필요 — 현재는 미구현, 전화번호가 PII이므로 인증 없이 노출 금지)
