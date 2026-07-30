---
template: design
version: 1.3
---

# multi-store-support Design Document (Phase 1 — DB 전환)

> **Summary**: `src/store.js`의 인메모리 배열을 Prisma 기반 DB로 교체한다. 지금은 계정 발급 없이 바로 검증 가능한 SQLite로 시작하고, `DATABASE_URL`만 바꾸면 운영 환경(Postgres/Supabase)로 그대로 전환되도록 설계한다.
>
> **Project**: chevrolet-toss-reservation-plugin
> **Version**: 0.1.0
> **Author**: (미지정)
> **Date**: 2026-07-30
> **Status**: Draft
> **Planning Doc**: [multi-store-support.plan.md](../01-plan/features/multi-store-support.plan.md)

> **Note**: 이 Design 문서는 bkit 표준 템플릿(Next.js/BaaS 전제) 중 이 프로젝트(커스텀 Express 백엔드, UI 변경 없음)에 해당하지 않는 섹션(5. UI/UX, BaaS API, MongoDB 스키마)은 "N/A"로 표시하고 생략한다.

---

## Context Anchor

| Key | Value |
|-----|-------|
| **WHY** | 인메모리 저장소로는 재배포/재시작마다 예약·결제·3개월 프로모션 예정 데이터가 전부 사라져 실서비스 운영이 불가능함 |
| **WHO** | 본사 운영 담당자, 가맹점 직원, 정비를 맡기는 손님 |
| **RISK** | DB 마이그레이션 도중 기존 API 응답 형식(필드명·타입)이 바뀌면 `toss-plugin/*.html`·`admin.html`이 깨질 수 있음 |
| **SUCCESS** | 서버를 재시작해도 매장/예약/결제/프로모션 예정 데이터가 그대로 남아있고, 기존 API 응답 스키마가 동일하게 유지되어야 함 |
| **SCOPE** | `src/store.js`만 내부 구현 교체 (함수 시그니처 유지), `server.js`는 호출부를 `await`로 전환, API 계약/프론트는 변경 없음 |

---

## 1. Overview

### 1.1 Design Goals

- `src/store.js`의 13개 export 함수 시그니처(이름·인자 순서·반환 shape)를 그대로 유지한 채 내부를 Prisma 쿼리로 교체한다.
- 로컬 개발은 SQLite(`file:./dev.db`, 계정 불필요)로 즉시 동작하고, 운영 환경은 `DATABASE_URL`만 Postgres로 바꾸면 동일 스키마로 전환되도록 한다.
- 대기번호(`queueNumber`) 채번을 매장·날짜별로 원자적(atomic)으로 유지한다 (동시 요청 시 중복 채번 방지).

### 1.2 Design Principles

- **함수 시그니처 안정성**: Plan 문서 §6.1에서 지목한 대로 `server.js` 호출부를 최소로 건드리기 위해 인터페이스를 유지한다.
- **점진적 전환**: 이번 단계는 데이터 계층만 교체하고, 인증/온보딩(Phase 3/4)은 건드리지 않는다.
- **운영 전환 무중단**: SQLite → Postgres 전환이 스키마 재작성 없이 `DATABASE_URL` 교체만으로 가능해야 한다 (Prisma는 provider 변경 시 마이그레이션 재생성이 필요하므로, 실제 Postgres 전환 시점에 `prisma migrate dev`를 다시 실행하는 것을 전제로 함 — 완전 무변경은 아니고 "스키마 재설계 없음"을 의미).

---

## 2. Architecture Options

### 2.0 Architecture Comparison

| Criteria | Option A: Minimal | Option B: Clean | Option C: Pragmatic |
|----------|:-:|:-:|:-:|
| **Approach** | `store.js` 안에 raw SQL 문자열 직접 작성 | 리포지토리 인터페이스 + Prisma 구현체 분리 (`src/repositories/`) | Prisma Client를 `store.js`에서 직접 쓰되 함수 시그니처는 유지 |
| **New Files** | 1 (schema.sql) | 6+ (interfaces, repo impl, DI 설정) | 2 (`prisma/schema.prisma`, migration) |
| **Modified Files** | `store.js` | `store.js`, `server.js`, 신규 repo 계층 | `store.js`, `server.js`(await 추가) |
| **Complexity** | Low (SQL 인젝션 위험 직접 관리 필요) | High (지금 규모엔 과설계) | Medium |
| **Maintainability** | Low | High | High |
| **Effort** | Low | High | Medium |
| **Risk** | Medium (수동 SQL 작성 실수) | Low | Low |
| **Recommendation** | 빠른 임시 조치 | 매장 수백~수천, 복잡한 도메인 규칙이 생길 때 | **기본 선택** |

**Selected**: Option C — **Rationale**: 지금 규모(단일 백엔드, 500개 매장이라도 테이블 3~4개 수준)에서 리포지토리 추상화 계층(Option B)은 과설계다. Prisma가 이미 타입 안전한 쿼리 빌더 + 마이그레이션을 제공하므로 raw SQL(Option A)보다 안전하다. `store.js`의 기존 함수 시그니처를 그대로 유지하면 `server.js`는 `await`만 추가하면 되어 변경 범위가 작다.

> 사용자가 "알아서 진행"을 요청했고, Plan 문서 §7.2에서 이미 Postgres/Prisma를 사전 결정해뒀으므로 이번 사이클은 Checkpoint 3(아키텍처 선택) 대화형 확인 없이 위 근거로 자동 선택하고 진행한다.

### 2.1 Component Diagram

```
┌──────────────────┐     ┌─────────────┐     ┌──────────────────────┐
│ toss-plugin/*.html│────▶│  server.js  │────▶│ src/store.js (Prisma) │
│  admin.html        │     │ (Express)   │     │  → SQLite(dev)/       │
└──────────────────┘     └─────────────┘     │    Postgres(prod)     │
                                              └──────────────────────┘
```

### 2.2 Data Flow

```
API 요청 → server.js 라우트 핸들러 → store.js 함수(await) → Prisma Client → DB → 응답
```

### 2.3 Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| `src/store.js` | `@prisma/client` | DB 접근 |
| `server.js` | `src/store.js` (이제 전부 async) | 라우트 핸들러가 `await`로 호출 |
| `prisma/schema.prisma` | `DATABASE_URL` env | dev=SQLite, prod=Postgres |

---

## 3. Data Model

### 3.1 Entity Definition (Prisma schema)

```prisma
model Store {
  id             String   @id @default(uuid())
  merchantId     String   @unique
  name           String
  businessNumber String?
  status         String   @default("active")
  createdAt      DateTime @default(now())
  reservations   Reservation[]
  payments       Payment[]
  queueCounters  QueueCounter[]
}

model Reservation {
  id          String    @id @default(uuid())
  storeId     String
  store       Store     @relation(fields: [storeId], references: [id])
  carNumber   String
  phone       String
  serviceType String
  queueNumber Int
  status      String    @default("waiting")
  createdAt   DateTime  @default(now())
  calledAt    DateTime?
  completedAt DateTime?

  @@index([storeId])
}

model Payment {
  id          String    @id @default(uuid())
  storeId     String
  store       Store     @relation(fields: [storeId], references: [id])
  paymentKey  String?   @unique
  carNumber   String?
  serviceType String?
  phone       String
  amount      Int?
  status      String    @default("requested")
  promoAt     DateTime
  promoSent   Boolean   @default(false)
  promoSentAt DateTime?
  createdAt   DateTime  @default(now())

  @@index([storeId])
}

model QueueCounter {
  id      String @id @default(uuid())
  storeId String
  store   Store  @relation(fields: [storeId], references: [id])
  date    String
  counter Int    @default(0)

  @@unique([storeId, date])
}
```

### 3.2 Entity Relationships

```
[Store] 1 ──── N [Reservation]
   │
   ├── 1 ──── N [Payment]
   └── 1 ──── N [QueueCounter]   (storeId + date 유니크 = 매장별·날짜별 원자적 채번)
```

### 3.3 Database Schema

SQLite(dev)/Postgres(prod) 둘 다 위 Prisma 스키마에서 `prisma migrate dev`로 자동 생성 — 수동 SQL 불필요.

---

## 4. API Specification

이번 단계는 **API 계약 변경 없음** — 기존 엔드포인트(`POST/GET /api/reservations`, `/api/payments`, `/api/admin/stores` 등)의 요청/응답 스키마는 그대로 유지한다. 내부적으로 동기 인메모리 호출이 `await` 비동기 DB 호출로 바뀔 뿐이다.

---

## 5. UI/UX Design

N/A — 이번 단계는 데이터 계층 교체만 다루며 UI 변경 없음.

---

## 6. Error Handling

### 6.1 Error Code Definition (변경/추가분만)

| Code | Message | Cause | Handling |
|------|---------|-------|----------|
| 500 | DB 연결 실패 | `DATABASE_URL` 오설정 또는 DB 다운 | 기존과 동일하게 `catch`에서 500 응답 + 로그. 헬스체크(`/healthz`)에 DB ping 추가는 Phase 5로 미룸 |

### 6.2 Error Response Format

기존과 동일 (`{ ok: false, error: string }`), 변경 없음.

---

## 7. Security Considerations

- [x] 기존 입력 검증(정규식) 로직 유지 — DB 교체와 무관
- [ ] Prisma 쿼리는 파라미터 바인딩을 자동 처리하므로 SQL 인젝션 위험이 raw SQL보다 낮음 (Option A 대비 이번 선택의 장점)
- [ ] `DATABASE_URL`은 `.env`에만 두고 커밋 금지 (`.gitignore`에 이미 `.env` 포함되어 있음, `dev.db` 파일도 추가 필요)

---

## 8. Test Plan

### 8.1 Test Scope

| Type | Target | Tool | Phase |
|------|--------|------|-------|
| L1: API 회귀 테스트 | 기존 엔드포인트가 DB 전환 후에도 동일하게 동작 | Node 스크립트로 curl 대체 fetch 호출 (지난 세션과 동일 방식) | Do |
| 영속성 테스트 | 서버 프로세스 재시작 후 데이터 유지 확인 | 서버 kill → 재기동 → 목록 조회 | Do |

### 8.2 L1: API Test Scenarios

| # | Endpoint | Method | Test Description | Expected Status | Expected Response |
|---|----------|--------|-------------------|:----------------:|--------------------|
| 1 | /api/admin/stores | POST | 매장 등록 | 200 | `.store.id` 존재 |
| 2 | /api/reservations | POST | 등록된 merchantId로 예약 | 200 | `.queueNumber` = 1 |
| 3 | /api/reservations | POST | 같은 매장 두 번째 예약 | 200 | `.queueNumber` = 2 (순차 증가) |
| 4 | /api/reservations | POST | 다른 매장 예약 | 200 | `.queueNumber` = 1 (매장별 독립 채번 유지) |
| 5 | /api/reservations?storeId= | GET | 매장별 필터 | 200 | 해당 매장 건수만 반환 |
| (재시작) | — | — | 서버 kill 후 재기동, 동일 요청 재조회 | — | 이전에 등록한 매장/예약이 그대로 조회됨 (인메모리 시절과의 핵심 차이) |

### 8.5 Seed Data Requirements

| Entity | Minimum Count | Key Fields Required |
|--------|:--------------:|----------------------|
| Store | 1 | `merchantId: '0'` (로컬 `sdk.js` 오버라이드와 짝) — 서버 부팅 시 `upsert`로 자동 시드 |

---

## 9. Clean Architecture

### 9.1 Layer Structure (이 프로젝트 실제 구조 기준)

| Layer | Responsibility | Location |
|-------|-----------------|----------|
| **Presentation** | 토스 SDK 화면, 관리자 화면 | `public/toss-plugin/`, `public/admin.html` |
| **Application** | 라우트 핸들러 (입력 검증, 알림톡 트리거) | `server.js` |
| **Infrastructure** | DB 접근 | `src/store.js` (Prisma Client), `src/solapi.js` |

### 9.2 Dependency Rules

`server.js`는 `src/store.js`의 export 함수만 호출하고, Prisma Client를 직접 import하지 않는다 (기존 원칙 유지 — README에 명시된 "함수 시그니처만 유지하면 내부 구현 교체 가능" 설계).

---

## 10. Coding Convention Reference

| Item | Convention Applied |
|------|----------------------|
| DB 함수 명명 | 기존 `store.js` 함수명 그대로 유지 (`createReservation`, `listReservations` 등) — 신규 함수만 추가 시 camelCase 유지 |
| 비동기 처리 | 모든 `store.js` export가 `async`로 전환되므로, `server.js`의 모든 호출부에 `await` 필수 |

---

## 11. Implementation Guide

### 11.1 File Structure

```
backend/
  prisma/
    schema.prisma       # 신규
    migrations/          # 신규 (prisma migrate dev가 생성)
  src/
    store.js              # 내부 구현을 Prisma로 교체 (함수 시그니처 유지)
  server.js               # 호출부에 await 추가, requireStore 미들웨어 async 전환
  .env.example             # DATABASE_URL 추가
  .gitignore                # dev.db 추가
```

### 11.2 Implementation Order

1. [ ] `prisma`, `@prisma/client` 의존성 추가 + `prisma/schema.prisma` 작성 (SQLite provider)
2. [ ] `prisma migrate dev`로 로컬 DB(`dev.db`) 생성
3. [ ] `src/store.js`를 Prisma 기반으로 재작성 (함수 시그니처 유지, 전부 `async`)
4. [ ] `server.js`의 모든 `store.js` 호출부에 `await` 추가, 동기였던 라우트 핸들러(`complete`, `delete`, `GET` 목록들, `/api/admin/stores`)를 `async`로 전환
5. [ ] 서버 부팅 시 기본 테스트 매장(`merchantId: '0'`)을 `upsert`로 시드
6. [ ] §8.2 L1 테스트로 회귀 검증 + 재시작 후 데이터 유지 확인

### 11.3 Session Guide

단일 세션으로 완료 가능한 규모(파일 수 적음, 함수 시그니처 유지로 변경 범위 작음) — 모듈 분리 없이 이어서 Do 단계로 진행한다.

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-07-30 | 최초 작성 (Phase 1: DB 전환, Option C 자동 선택) | (미지정) |
