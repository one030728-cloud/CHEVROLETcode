---
template: plan
version: 1.3
---

# multi-store-support Planning Document

> **Summary**: 쉐보레 대리점 1곳 전용으로 만들어진 토스프론트 플러그인·백엔드를, 최대 500개 가맹점을 동시에 운영할 수 있는 멀티 테넌트 서비스로 확장한다.
>
> **Project**: chevrolet-toss-reservation-plugin
> **Version**: 0.1.0
> **Author**: (미지정)
> **Date**: 2026-07-30
> **Status**: Draft (Phase 2 구현 완료, Phase 1/3/4/5 예정)

---

## Executive Summary

| Perspective | Content |
|-------------|---------|
| **Problem** | 플러그인이 토스 SDK가 제공하는 `merchant.id`를 읽지 않고, 서버(`store.js`)도 매장 개념 없이 전역 배열 하나에 모든 예약/결제를 저장해서 매장이 2곳 이상이 되는 순간 데이터가 섞인다. DB도 없고 관리자 인증도 토큰 1개 공유라 500개 매장 운영이 불가능한 상태였다. |
| **Solution** | ① `sdk.merchant.id` 캡처 → API 전달 → 서버가 `store_id`로 매핑해 모든 쿼리를 스코프(완료) ② 인메모리를 Postgres로 교체 ③ 관리자 인증을 본사/매장 2계층 role 기반으로 전환 ④ 매장 대량 온보딩·발신번호 정책 확정 ⑤ 유료 호스팅·모니터링으로 스케일 검증 |
| **Function/UX Effect** | 매장 손님은 지금과 동일한 예약/결제 플로우를 그대로 쓰지만, 백엔드가 어느 매장 요청인지 정확히 구분해 대기번호·예약목록·알림톡이 매장별로 독립적으로 동작한다. 관리자는 본사 전체 현황판과 매장별 화면을 함께 갖게 된다. |
| **Core Value** | 하나의 코드베이스와 인프라로 가맹점 1개~500개를 모두 안전하게(데이터 혼입 없이) 운영할 수 있게 되어, 매장이 늘어날 때마다 코드를 다시 짤 필요가 없어진다. |

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 현재 구조(전역 인메모리 배열 + 토큰 1개 공유)로는 매장이 2곳만 늘어도 예약/결제 데이터가 섞이고 관리자 접근 통제가 불가능해 실서비스 사고로 직결됨 |
| **WHO** | 본사(HQ) 운영 담당자, 각 가맹점 직원/관리자, 정비를 맡기는 최종 손님 |
| **RISK** | `merchant.id`를 서버가 신뢰할 수 있는 값으로 검증하지 않으면(스푸핑) 다른 매장 데이터를 조회/조작당할 수 있음 — Phase 3(관리자 인증)에서 role 기반 접근 통제로 보완 필요 |
| **SUCCESS** | 서로 다른 두 매장이 동시에 예약을 받아도 대기번호·예약목록·알림톡이 서로 섞이지 않고, 관리자 화면에서 매장별/전체 조회가 모두 가능해야 함 |
| **SCOPE** | 1) DB 전환 2) 가맹점 식별(merchantId→store_id) 3) 관리자 2계층 인증 4) 500개 온보딩 준비 5) 스케일 검증 — 이번 사이클은 2)까지 구현 완료, 나머지는 백로그 |

---

## 1. Overview

### 1.1 Purpose

토스프론트 단말기에서 동작하는 예약·결제·알림톡 플러그인을 쉐보레 대리점 1곳이 아니라 최대 500개 가맹점이 공유하는 백엔드로 확장한다. 각 매장의 예약/결제/대기열/알림톡이 서로 독립적으로 동작해야 하고, 본사는 전체 매장을 조망할 수 있는 관리자 화면을 가져야 한다.

### 1.2 Background

기존 코드는 단일 매장 프로토타입으로 시작되어 `src/store.js`가 인메모리 전역 배열로만 예약/결제를 관리하고, 관리자 인증도 `ADMIN_TOKEN` 하나를 전 매장이 공유하는 구조였다. `backend/public/toss-plugin/onboarding.html` 주석에도 "나중에 매장이 여러 곳으로 늘어나면... 구현하면 된다"고 스스로 명시되어 있을 만큼 확장이 예정된 구조였다. 이번 검토에서 토스 SDK가 이미 `sdk.merchant.id`/`serialNumber`로 가맹점 식별자를 제공하는데도 플러그인이 이 값을 읽지 않고 버리는 것을 확인했다.

### 1.3 Related Documents

- 검토 문서: `docs/multi-store-architecture-review.md` (플러그인 코드 대 토스 SDK 문서 검토 + 500개 가맹점 아키텍처 설계 전체)
- 프로젝트 개요: `README.md`

---

## 2. Scope

### 2.1 In Scope

- [x] **Phase 2 — 가맹점 식별 (구현 완료)**: `toss-plugin/reservation.html`·`payment.html`이 `sdk.merchant.id`를 읽어 API로 전달, 서버(`requireStore` 미들웨어)가 `merchantId → store_id`로 변환, `src/store.js`의 모든 예약/결제/대기번호를 `store_id`로 스코프, `GET/POST /api/admin/stores`로 매장 등록·조회, `admin.html`에 매장 선택 드롭다운·매장 등록 폼 추가
- [ ] **Phase 1 — DB 전환**: `src/store.js`를 Postgres(Prisma) 기반으로 교체 (함수 시그니처 유지), 3개월 프로모션 예약이 재시작에도 유실되지 않도록 함
- [x] **Phase 3 — 관리자 2계층 인증 (구현 완료)**: `ADMIN_TOKEN` 공유 방식을 폐지하고 이메일/비밀번호 로그인 + JWT(`hq_admin`/`store_admin` role, `storeId` 클레임)로 전환. `store_admin`은 자기 매장으로 강제 스코프되어 다른 매장 예약 조작 시 403. `admin.html`에 로그인/매장관리자 발급 UI 반영. (전체 현황판 대시보드 고도화는 향후 개선 여지로 남김)
- [x] **Phase 4 — 500개 온보딩 준비 (구현 완료)**: 매장 대량 등록(`POST /api/admin/stores/bulk`, 항목별 성공/실패 분리), 발신번호/카카오채널 정책 확정(브랜드 공용, `#{매장명}` 변수로 구분 — 프랜차이즈 개별 사업자로 바뀌면 매장별 발신번호로 확장 가능하게 설계), 결제 승인/취소 웹훅(`payment.payment.approved.v1`/`cancelled.v1`) 수신 엔드포인트 추가(서명 검증·중복방지 구조는 완료, 실제 페이로드 스펙/웹훅 등록은 토스 담당자 문의 필요)
- [ ] **Phase 5 — 스케일 검증**: 유료 호스팅 전환(Render 무료 플랜 슬립 제거), 커넥션 풀/인덱스 점검, 부하 테스트, 감사 로그·모니터링 대시보드

### 2.2 Out of Scope

- 토스플레이스 개발자센터에서의 실제 플러그인 등록·테스트 가맹점 연결·단말기 온보딩 (사업자 계정 로그인 필요, 사용자가 직접 진행)
- 카카오 알림톡 채널/템플릿 심사 (솔라피/카카오 측 승인 절차, 코드 밖의 일)
- 정비 항목(`SERVICE_TYPES`)의 매장별 커스터마이즈 (현재는 전역 공용, 별도 기능으로 분리 가능)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 토스 SDK `merchant.id`를 예약/결제 API 요청에 포함시켜 서버가 가맹점을 식별한다 | High | ✅ Done |
| FR-02 | 등록되지 않은/비활성 `merchantId`의 요청은 400/404/403으로 거부한다 | High | ✅ Done |
| FR-03 | 예약·결제·대기번호·전화번호↔예약 매칭이 매장(store_id) 단위로 완전히 격리된다 | High | ✅ Done |
| FR-04 | 본사 관리자가 매장을 등록/조회할 수 있다 (`/api/admin/stores`) | High | ✅ Done |
| FR-05 | 관리자 화면에서 매장을 선택해 필터링하거나 "전체 매장" 뷰로 조회할 수 있다 | Medium | ✅ Done |
| FR-06 | 예약/결제 데이터가 서버 재시작 후에도 유실되지 않는다 (DB 전환) | High | ⏳ Pending |
| FR-07 | 매장 관리자는 자기 매장 데이터만, 본사 관리자는 전체 매장을 볼 수 있도록 계정 기반으로 권한이 분리된다 | High | ✅ Done |
| FR-08 | 결제 승인/취소가 클라이언트 콜백 실패와 무관하게 웹훅으로 서버에 확실히 기록된다 | Medium | ⚠️ Partial — 실제 토스 문서 대조로 서명 검증(HMAC 스펙)은 정확히 맞춤. 다만 payload에 `paymentKey` 필드가 없어 우리 결제 레코드와 자동 매칭은 아직 미해결(로그만 남김) — `developer-support@tossplace.com` 문의 필요 |
| FR-09 | 매장을 다수 한 번에 등록(대량 온보딩)할 수 있다 | Medium | ✅ Done |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|--------------------|
| Data Isolation | 매장 A의 요청이 매장 B의 데이터에 절대 접근/영향을 줄 수 없어야 함 | 서로 다른 storeId로 동시 예약 생성 후 목록 분리 확인 (완료: 스모크 테스트로 검증) |
| Scalability | 500개 매장, 매장당 일 예약/결제 수십 건 수준의 동시 트래픽을 견뎌야 함 | 부하 테스트 (Phase 5) |
| Availability | 3개월 후 프로모션 스케줄러가 서버 재시작/슬립과 무관하게 정시에 가깝게 동작해야 함 | 별도 워커/외부 크론 전환 후 실행 로그 확인 (Phase 1, 5) |
| Security | 관리자 API가 매장별 접근 통제를 강제해야 함 | JWT role 기반 인가 테스트 (Phase 3) |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [x] `merchant.id` → `store_id` 매핑 및 요청 필수화 (Phase 2)
- [x] 예약/결제/대기번호가 매장별로 독립 동작 (Phase 2)
- [ ] Postgres 기반 영속 저장 (Phase 1)
- [ ] 본사/매장 2계층 관리자 인증 (Phase 3)
- [ ] 500개 매장 대량 온보딩 플로우 (Phase 4)
- [ ] 유료 호스팅 + 모니터링 (Phase 5)

### 4.2 Quality Criteria

- [ ] 서로 다른 매장 간 데이터 혼입 사례 0건 (수동/자동 테스트)
- [ ] 재배포/재시작 후 예약·결제·프로모션 예정 데이터 유실 0건 (Phase 1 이후)
- [ ] 관리자 API에 대해 타 매장 접근 시도가 전부 403/404로 차단됨 (Phase 3 이후)

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| `merchantId`를 서버가 무조건 신뢰(스푸핑 방지 부재) | High | Medium | Phase 3에서 관리자/매장 인증을 강화하고, 결제 API는 추가로 웹훅(FR-08)으로 서버 측 검증을 이중화 |
| DB 전환 지연 시 인메모리 상태로 서비스 지속 | High | Medium | Phase 1을 Phase 4(대량 온보딩) 이전에 반드시 완료하는 순서를 강제 |
| 알림톡 발신번호 정책(브랜드 공용 vs 매장별) 미확정으로 Phase 4 착수 지연 | Medium | Medium | 사업 구조(직영/프랜차이즈 개별 사업자) 확인을 Phase 4 착수 조건으로 명시 |
| 웹훅 등록이 토스플레이스 담당자 문의에 의존(자체 설정 불가) | Medium | Low | Phase 4 시작 시점에 미리 담당자 문의 절차를 개시해 리드타임 확보 |

---

## 6. Impact Analysis

### 6.1 Changed Resources

| Resource | Type | Change Description |
|----------|------|--------------------|
| `backend/src/store.js` | 인메모리 데이터 계층 | `stores` 레지스트리 추가, `reservations`/`payments`에 `storeId` 필드 추가, 대기번호 카운터를 매장별로 분리 |
| `backend/server.js` | API 서버 | `requireStore` 미들웨어 추가, `/api/reservations`·`/api/payments` POST에 `merchantId` 필수화, GET 목록에 `?storeId=` 필터 추가, `/api/admin/stores` 신설 |
| `backend/public/toss-plugin/reservation.html`, `payment.html` | 프론트(토스 SDK) | `sdk.merchant.id`를 읽어 API 요청 바디에 포함 |
| `backend/public/admin.html` | 관리자 화면 | 매장 선택 드롭다운, 매장 등록 폼, 목록/호출/테스트예약에 storeId 반영 |

### 6.2 Current Consumers

| Resource | Operation | Code Path | Impact |
|----------|-----------|-----------|--------|
| `listReservations`/`listPayments` | READ | `server.js`의 관리자 GET 엔드포인트들 | Breaking(이미 반영) — 반환값이 이제 storeId 기준으로 필터링됨. `admin.html`도 함께 수정 완료 |
| `createReservation`/`createPayment` | CREATE | `POST /api/reservations`, `POST /api/payments` | Breaking(이미 반영) — `storeId` 인자가 필수로 추가됨. 호출부(`server.js`)도 함께 수정 완료 |
| `findLatestReservationByPhone` | READ | `POST /api/payments` 내부 | Breaking(이미 반영) — 시그니처에 `storeId`가 추가되어 매장 스코프 안에서만 검색 |
| `dailyQueueCounter`(구) | READ/WRITE | 대기번호 채번 | Breaking(이미 반영) — `dailyQueueCounters`(Map, storeId 키)로 교체 |

### 6.3 Verification

- [x] 위 4개 소비처 모두 이번 세션에서 함께 수정하고 로컬 스모크 테스트(2개 매장 동시 생성 → 대기번호/목록 분리 확인)로 검증함
- [ ] 인증/권한 변경(Phase 3)이 기존 단일 토큰 기반 운영 흐름을 깨지 않는지는 별도 검증 필요
- [ ] DB 전환(Phase 1) 후 동일한 격리 동작이 유지되는지 재검증 필요

---

## 7. Architecture Considerations

### 7.1 Project Level Selection

이 프로젝트는 bkit BaaS(bkend.ai) 기반이 아니라 **커스텀 Node/Express 백엔드 + 자체 Postgres**를 쓰는 구조라 bkit의 Starter/Dynamic/Enterprise 템플릿 레벨 분류를 그대로 적용하지 않는다. 참고용으로 성격상 "Dynamic(백엔드 있는 풀스택 서비스)"에 가장 가깝다.

| Level | Characteristics | Recommended For | Selected |
|-------|-----------------|-----------------|:--------:|
| **Starter** | Simple structure | Static sites | ☐ |
| **Dynamic** | Feature-based modules, custom backend | Backend가 있는 웹앱 (참고용, bkend.ai 아님) | ☑ (참고) |
| **Enterprise** | Strict layer separation, microservices | 대규모 트래픽/복잡 아키텍처 | ☐ |

### 7.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| 가맹점 식별 | merchantId를 쿼리파라미터/헤더/바디 중 어디에 실을지 | 요청 바디(JSON) | 기존 POST 요청 구조와 일관되고, GET 계열은 `?storeId=` 쿼리로 분리해 관리자 화면에서 다루기 쉬움 |
| 매장 스코프 강제 위치 | 라우트 핸들러마다 직접 필터 vs 공용 미들웨어 | 공용 미들웨어(`requireStore`) | 실수로 스코프를 빼먹는 라우트가 생기는 걸 구조적으로 방지 |
| DB(Phase 1) | Postgres(Supabase) vs MongoDB | Postgres | 관계형 데이터(매장-예약-결제)에 적합, README에서도 기존에 Supabase를 최우선으로 지목 |
| 관리자 인증(Phase 3) | JWT vs 세션 | JWT (role: hq_admin/store_admin, storeId 클레임 포함) | 매장 수가 많아질수록 stateless 인증이 여러 인스턴스로 수평 확장하기 쉬움 |
| 알림톡 발신 정책(Phase 4) | 브랜드 공용 채널 vs 매장별 발신번호 | 사업 구조 확인 후 결정 (옵션 A/B 병기) | 프랜차이즈 개별 사업자 여부에 따라 통신망법상 발신자 실명 요건이 달라질 수 있음 |

### 7.3 Clean Architecture Approach

```
Selected Level: Custom Node/Express (bkit 템플릿 레벨 밖)

Folder Structure (변경 후):
backend/
  server.js              # Express 라우트 + requireStore/requireAdmin 미들웨어
  src/
    store.js              # 데이터 계층 (Phase 1에서 Postgres/Prisma로 교체 예정, 함수 시그니처는 유지)
    solapi.js              # 알림톡 발송 (Phase 4에서 매장별 발신번호 분기 추가 예정)
  public/
    admin.html             # 관리자 화면 (Phase 3에서 JWT 로그인 + 2계층으로 리팩터링 예정)
    toss-plugin/            # merchant.id 캡처 반영 완료
```

---

## 8. Convention Prerequisites

### 8.1 Existing Project Conventions

- [x] `README.md`에 API/구조/환경변수 문서화 존재 (프로젝트 자체 컨벤션 문서)
- [ ] `CLAUDE.md` 없음
- [ ] `docs/01-plan/conventions.md` 없음 — 정비 항목(`SERVICE_TYPES`)이 3곳에 하드코딩되는 등 컨벤션 문서화 여지가 있으나 이번 스코프 밖

### 8.2 Conventions to Define/Verify

| Category | Current State | To Define | Priority |
|----------|---------------|-----------|:--------:|
| API 인증 헤더 | `x-admin-token` 단일 값 | Phase 3에서 `Authorization: Bearer <jwt>`로 전환 | High |
| 매장 식별자 전달 방식 | 요청 바디 `merchantId` (신규 확정) | 이미 확정, 향후 API 추가 시 동일 규칙 적용 | Medium |

### 8.3 Environment Variables Needed

| Variable | Purpose | Scope | To Be Created |
|----------|---------|-------|:-------------:|
| `DATABASE_URL` | Postgres 연결 (Phase 1) | Server | ☐ |
| `JWT_SECRET` | 관리자 로그인 토큰 서명 (Phase 3) | Server | ☐ |
| `ADMIN_TOKEN` | (현행) 관리자 인증, Phase 3에서 폐지 예정 | Server | 이미 존재 |
| `SOLAPI_*` | 알림톡/문자 발송 (기존) | Server | 이미 존재 |

### 8.4 Pipeline Integration

해당 없음 — 이 프로젝트는 bkit 9-phase Development Pipeline을 사용하는 프로젝트가 아니라 독립 리포지토리이다.

---

## 9. Next Steps

1. [ ] Design 문서 작성 (`multi-store-support.design.md`) — Phase 1(DB 전환) 또는 Phase 3(관리자 인증) 중 어느 것을 먼저 설계할지 결정 필요 (권장: Phase 1 우선 — Phase 3/4가 영속 데이터 위에서 동작해야 하므로)
2. [ ] 사업 구조(직영 vs 프랜차이즈 개별 사업자) 확인 → Phase 4 알림톡 발신 정책 결정에 필요
3. [ ] Postgres(Supabase) 계정/연결 정보 준비

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-07-30 | 최초 작성. Phase 2(가맹점 식별) 구현 완료 반영, Phase 1/3/4/5 백로그로 정리 | (미지정) |
