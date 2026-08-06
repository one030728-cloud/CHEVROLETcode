// Design Ref: docs/02-design/features/multi-store-support.design.md §2.0 (Option C)
// DB 데이터 계층. 예전 인메모리 버전과 export 함수 시그니처를 그대로 유지한 채
// 내부만 Prisma(Client)로 교체했다 — server.js는 await만 붙이면 그대로 동작한다.
// 로컬/프로토타입은 SQLite(.env의 DATABASE_URL=file:./dev.db), 운영 전환 시
// DATABASE_URL을 Postgres로 바꾸고 prisma/schema.prisma의 provider를 postgresql로 바꾼 뒤
// `npx prisma migrate dev`를 다시 실행하면 된다 (docs/multi-store-architecture-review.md 참고).

const { PrismaClient } = require('@prisma/client')
const { hashPassword } = require('./auth')

const prisma = new PrismaClient()

// 매장 영업일은 한국 시간(KST, UTC+9) 자정 기준으로 리셋되어야 한다. `new Date().toISOString()`을
// 그대로 쓰면 UTC 자정(=KST 오전 9시) 기준이 되어 새벽 시간대 예약의 날짜 경계가 어긋난다.
function kstDateString(d = new Date()) {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function kstDayStartUtc(dateStr) {
  return new Date(`${dateStr}T00:00:00+09:00`)
}

// Plan SC: FR-07 — 최초 부팅 시 본사(hq_admin) 계정이 하나도 없으면 자동 생성한다.
// 비밀번호는 ADMIN_BOOTSTRAP_PASSWORD가 있으면 그 값을, 없으면 무작위로 생성해 콘솔에 한 번만 출력한다.
async function ensureDefaultHqAdmin() {
  const existing = await prisma.adminUser.findFirst({ where: { role: 'hq_admin' } })
  if (existing) return

  if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_BOOTSTRAP_EMAIL || !process.env.ADMIN_BOOTSTRAP_PASSWORD)) {
    throw new Error('운영 환경에서 첫 본사 관리자 계정을 만들려면 ADMIN_BOOTSTRAP_EMAIL/PASSWORD가 필요합니다.')
  }

  const email = process.env.ADMIN_BOOTSTRAP_EMAIL || 'admin@local'
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || require('node:crypto').randomBytes(9).toString('base64url')
  const passwordHash = await hashPassword(password)

  await prisma.adminUser.create({
    data: { email, passwordHash, role: 'hq_admin', storeId: null },
  })

  console.log('='.repeat(60))
  console.log('[bootstrap] 본사 관리자 계정이 생성되었습니다. 최초 1회만 출력됩니다.')
  console.log(`  이메일: ${email}`)
  if (!process.env.ADMIN_BOOTSTRAP_PASSWORD) {
    console.log(`  비밀번호(무작위 생성): ${password}`)
    console.log('  -> .env에 ADMIN_BOOTSTRAP_PASSWORD로 고정값을 지정하면 재생성 시에도 동일 비밀번호를 씁니다.')
  } else {
    console.log('  비밀번호: .env의 ADMIN_BOOTSTRAP_PASSWORD 값 사용')
  }
  console.log('='.repeat(60))
}

function findAdminUserByEmail(email) {
  return prisma.adminUser.findUnique({ where: { email } })
}

function getAdminUser(id) {
  return prisma.adminUser.findUnique({ where: { id } })
}

function createAdminUser({ email, passwordHash, role, storeId }) {
  return prisma.adminUser.create({ data: { email, passwordHash, role, storeId: storeId || null } })
}

async function markAdminLogin(id) {
  try {
    return await prisma.adminUser.update({ where: { id }, data: { lastLoginAt: new Date() } })
  } catch {
    return null
  }
}

// 로컬 개발/토스프론트 미리보기용 기본 가맹점.
// sdk.js의 overrides({ merchant: { id: 0, ... } })와 짝을 맞춘 값이라, 서버를 새로 띄워도
// 로컬 브라우저 미리보기(merchantId=0)가 바로 동작한다. upsert라 여러 번 불려도 안전하다.
// Plan SC: FR-06 — 서버 재시작 후에도 매장이 남아있는지 확인하는 시드 데이터(§8.5).
async function ensureDefaultStore() {
  // 테스트 merchantId=0은 로컬 미리보기 전용이다. Cloud Run 운영 컨테이너에서
  // 자동 시드되면 실제 매장 등록 정책을 우회하므로 production에서는 만들지 않는다.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_TEST_STORE !== 'true') return
  await prisma.store.upsert({
    where: { merchantId: '0' },
    update: {},
    create: { merchantId: '0', name: '쉐보레 대리점 (테스트)', businessNumber: '0000000000' },
  })
}

function createStore({ merchantId, name, businessNumber }) {
  return prisma.store.create({
    data: { merchantId: String(merchantId), name, businessNumber: businessNumber || null },
  })
}

function listStores() {
  return prisma.store.findMany()
}

// Design Ref: Phase 4 대량 온보딩. 각 항목을 개별 트랜잭션으로 처리해서 하나가 실패(중복 merchantId 등)해도
// 나머지는 계속 등록되고, 항목별 성공/실패를 그대로 돌려준다.
async function bulkCreateStores(items) {
  const results = []
  for (const item of items) {
    const merchantId = String(item.merchantId ?? '').trim()
    const name = String(item.name ?? '').trim()
    const businessNumber = String(item.businessNumber ?? '').trim()
    if (!merchantId || !name) {
      results.push({ merchantId, ok: false, error: 'merchantId/name이 필요합니다.' })
      continue
    }
    try {
      const store = await createStore({ merchantId, name, businessNumber })
      results.push({ merchantId, ok: true, store })
    } catch (e) {
      results.push({ merchantId, ok: false, error: '이미 등록된 merchantId이거나 저장에 실패했습니다.' })
    }
  }
  return results
}

function getStore(id) {
  return prisma.store.findUnique({ where: { id } })
}

function findStoreByMerchantId(merchantId) {
  if (merchantId === undefined || merchantId === null || merchantId === '') return null
  return prisma.store.findUnique({ where: { merchantId: String(merchantId) } })
}

// 매장·날짜별 원자적 채번 + "앞에 몇 명 있는지" 계산 + 예약 생성을 하나의 트랜잭션으로 묶는다.
// 예전엔 server.js가 (인원수 조회) -> (예약 생성)을 별도 호출로 나눠서 했는데, 그 사이에 다른 요청이
// 끼어들면 두 손님이 동시에 "앞에 아무도 없음(peopleAhead=0)"으로 계산되어 둘 다 순서 호출 알림톡을
// 받는 경쟁 상태가 있었다. SQLite/Prisma 트랜잭션 안에서 카운트→채번→생성을 순서대로 묶으면
// 같은 트랜잭션이 끝나기 전까지 다른 트랜잭션이 끼어들 수 없어 안전해진다.
async function createReservation({ storeId, carNumber, phone, serviceType, idempotencyKey }) {
  const today = kstDateString()
  try {
    return await prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.reservation.findUnique({ where: { idempotencyKey } })
        if (existing) {
          if (existing.storeId !== storeId) {
            const conflict = new Error('Idempotency-Key가 다른 매장에서 이미 사용되었습니다.')
            conflict.code = 'IDEMPOTENCY_KEY_CONFLICT'
            throw conflict
          }
          const peopleAhead = await tx.reservation.count({
            where: {
              storeId,
              status: { not: 'completed' },
              createdAt: { lt: existing.createdAt },
            },
          })
          return { reservation: existing, peopleAhead, duplicate: true }
        }
      }

      const peopleAhead = await tx.reservation.count({
        where: { storeId, status: { not: 'completed' } },
      })

      const existingCounter = await tx.queueCounter.findUnique({
        where: { storeId_date: { storeId, date: today } },
      })
      const queueNumber = existingCounter
        ? (await tx.queueCounter.update({
            where: { id: existingCounter.id },
            data: { counter: { increment: 1 } },
          })).counter
        : (await tx.queueCounter.create({ data: { storeId, date: today, counter: 1 } })).counter

      const reservation = await tx.reservation.create({
        data: {
          storeId,
          carNumber,
          phone,
          serviceType,
          queueNumber,
          idempotencyKey: idempotencyKey || null,
          status: 'waiting',
        },
      })

      return { reservation, peopleAhead, duplicate: false }
    })
  } catch (error) {
    // 두 요청이 같은 idempotency key로 동시에 들어오면 둘 다 사전 조회를 통과할 수 있다.
    // unique 제약에서 진 요청은 이미 생성된 예약을 반환해 재시도도 안전하게 만든다.
    if (error?.code === 'P2002' && idempotencyKey) {
      const existing = await prisma.reservation.findUnique({ where: { idempotencyKey } })
      if (existing?.storeId === storeId) {
        const peopleAhead = await prisma.reservation.count({
          where: {
            storeId,
            status: { not: 'completed' },
            createdAt: { lt: existing.createdAt },
          },
        })
        return { reservation: existing, peopleAhead, duplicate: true }
      }
    }
    throw error
  }
}

// storeId를 안 넘기면(관리자 "전체 매장 보기") 전체를 반환한다.
function listReservations(storeId) {
  return prisma.reservation.findMany({
    where: storeId ? { storeId } : undefined,
    orderBy: { createdAt: 'asc' },
  })
}

// store를 함께 로드해 알림톡 발송 시 #{매장명}을 채울 수 있게 한다 (Phase 4).
function getNextWaitingReservation(storeId) {
  return prisma.reservation.findFirst({
    where: { storeId, status: 'waiting' },
    orderBy: { createdAt: 'asc' },
    include: { store: true },
  })
}

function getReservation(id) {
  return prisma.reservation.findUnique({ where: { id }, include: { store: true } })
}

async function deleteReservation(id) {
  try {
    await prisma.reservation.delete({ where: { id } })
    return true
  } catch {
    return false
  }
}

async function markReservationCalled(id) {
  try {
    const result = await prisma.reservation.updateMany({
      where: { id, status: 'waiting' },
      data: { status: 'called', calledAt: new Date() },
    })
    if (!result.count) return null
    return prisma.reservation.findUnique({ where: { id }, include: { store: true } })
  } catch {
    return null
  }
}

// 정비가 끝나 정비 베이(자리)가 비었다는 뜻. 관리자가 직접 처리해야 한다 — 알림톡 발송 성공/실패와는
// 별개로, 이걸 눌러야 다음 예약의 앞사람 계산에서 빠져 대기인원이 줄어든다.
async function markReservationCompleted(id) {
  try {
    const result = await prisma.reservation.updateMany({
      where: { id, status: { in: ['called', 'notify_failed'] } },
      data: { status: 'completed', completedAt: new Date() },
    })
    if (!result.count) return null
    return prisma.reservation.findUnique({ where: { id }, include: { store: true } })
  } catch {
    return null
  }
}

async function markReservationNotifyFailed(id) {
  try {
    const result = await prisma.reservation.updateMany({
      where: { id, status: 'called' },
      data: { status: 'notify_failed' },
    })
    return result.count ? prisma.reservation.findUnique({ where: { id }, include: { store: true } }) : null
  } catch {
    return null
  }
}

async function markPaymentStatus(id, status) {
  try {
    return await prisma.payment.update({ where: { id }, data: { status } })
  } catch {
    return null
  }
}

// 결제 화면에서 차량번호를 다시 입력받는 대신, 전화번호로 이 손님의 예약 기록을 찾아
// 차량번호/정비항목을 그대로 가져다 쓴다. 같은 매장(storeId) 안에서만 찾는다 — 다른 매장에
// 등록된 동일 전화번호 예약을 잘못 가져오면 안 되기 때문이다.
// 오늘 등록한 예약을 우선하고(같은 날 재방문 등으로 여러 건이 있어도 최신 것 사용),
// 오늘 것이 없으면 그 번호로 등록된 가장 최근 예약을 쓴다.
async function findLatestReservationByPhone(storeId, phone) {
  const todayStart = kstDayStartUtc(kstDateString())
  const todayMatch = await prisma.reservation.findFirst({
    where: { storeId, phone, createdAt: { gte: todayStart } },
    orderBy: { createdAt: 'desc' },
  })
  if (todayMatch) return todayMatch
  return prisma.reservation.findFirst({
    where: { storeId, phone },
    orderBy: { createdAt: 'desc' },
  })
}

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000

function findPaymentByKey(paymentKey) {
  if (!paymentKey) return null
  return prisma.payment.findUnique({ where: { paymentKey } })
}

function createPayment({ storeId, paymentKey, carNumber, serviceType, phone, amount }) {
  return prisma.payment.create({
    data: {
      storeId,
      paymentKey: paymentKey || null,
      carNumber: carNumber || null,
      serviceType: serviceType || null,
      phone,
      amount: amount ?? null,
      status: 'requested',
      promoAt: new Date(Date.now() + THREE_MONTHS_MS),
    },
  })
}

// storeId를 안 넘기면(관리자 "전체 매장 보기") 전체를 반환한다.
function listPayments(storeId) {
  return prisma.payment.findMany({
    where: storeId ? { storeId } : undefined,
    orderBy: { createdAt: 'asc' },
  })
}

// Cloud Scheduler는 최소 한 번 전달하고, 동일한 작업이 동시에 들어올 수 있다.
// 외부 알림 API를 호출하기 전에 짧은 claim을 원자적으로 잡아 같은 결제건을 다른
// 인스턴스가 동시에 처리하지 않게 한다. 프로세스가 죽어 claim만 남은 건은 10분 후
// 다시 claim할 수 있다(외부 API 호출 직후 프로세스가 죽는 경우의 완전한 exactly-once는
// 알림 제공자 idempotency 키가 없으면 보장할 수 없으므로, 성공 후 promoSent를 최종 기준으로 둔다).
async function claimDuePromotions(limit = 100) {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - 10 * 60 * 1000)
  const candidates = await prisma.payment.findMany({
    where: {
      promoSent: false,
      promoAt: { lte: now },
      OR: [{ promoClaimedAt: null }, { promoClaimedAt: { lt: staleBefore } }],
    },
    orderBy: { promoAt: 'asc' },
    take: limit,
    include: { store: true },
  })

  const claimed = []
  for (const candidate of candidates) {
    const result = await prisma.payment.updateMany({
      where: {
        id: candidate.id,
        promoSent: false,
        OR: candidate.promoClaimedAt
          ? [{ promoClaimedAt: candidate.promoClaimedAt }]
          : [{ promoClaimedAt: null }],
      },
      data: { promoClaimedAt: now },
    })
    if (result.count) {
      const payment = await prisma.payment.findUnique({ where: { id: candidate.id }, include: { store: true } })
      if (payment) claimed.push(payment)
    }
  }
  return claimed
}

async function markPromoSent(id) {
  try {
    const result = await prisma.payment.updateMany({
      where: { id, promoSent: false, promoClaimedAt: { not: null } },
      data: { promoSent: true, promoSentAt: new Date(), promoClaimedAt: null },
    })
    if (!result.count) return null
    return prisma.payment.findUnique({ where: { id } })
  } catch {
    return null
  }
}

async function releasePromoClaim(id) {
  try {
    await prisma.payment.updateMany({
      where: { id, promoSent: false },
      data: { promoClaimedAt: null },
    })
  } catch {
    // 다음 Scheduler 실행에서 stale claim으로 회수할 수 있으므로 release 실패는 삼킨다.
  }
}

// 웹훅 중복 수신 방지. 이미 처리한 x-toss-webhook-id면 false(스킵), 처음 보는 id면 기록하고 true.
async function recordWebhookEventOnce(webhookId, eventType) {
  try {
    await prisma.webhookEvent.create({ data: { id: webhookId, eventType } })
    return true
  } catch {
    return false // unique 제약 위반 = 이미 처리된 이벤트
  }
}

module.exports = {
  ensureDefaultStore,
  ensureDefaultHqAdmin,
  bulkCreateStores,
  recordWebhookEventOnce,
  findAdminUserByEmail,
  getAdminUser,
  createAdminUser,
  markAdminLogin,
  createStore,
  listStores,
  getStore,
  findStoreByMerchantId,
  createReservation,
  listReservations,
  getNextWaitingReservation,
  getReservation,
  deleteReservation,
  markReservationCalled,
  markReservationCompleted,
  markReservationNotifyFailed,
  findLatestReservationByPhone,
  createPayment,
  findPaymentByKey,
  markPaymentStatus,
  listPayments,
  claimDuePromotions,
  markPromoSent,
  releasePromoClaim,
}
