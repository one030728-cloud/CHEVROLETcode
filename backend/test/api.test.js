const assert = require('node:assert/strict')
const { after, before, beforeEach, test } = require('node:test')
const { URL } = require('node:url')
const request = require('supertest')

function requireLocalTestDatabase() {
  const rawUrl = process.env.DATABASE_URL
  if (!rawUrl) {
    throw new Error(
      'DATABASE_URL이 필요합니다. 운영 DB를 절대 사용하지 말고 localhost의 devdb를 실행한 뒤 npm test를 실행하세요.'
    )
  }

  const databaseUrl = new URL(rawUrl)
  const localHosts = new Set(['localhost', '127.0.0.1', '::1'])
  const databaseName = databaseUrl.pathname.replace(/^\//, '')
  if (!localHosts.has(databaseUrl.hostname) || databaseName !== 'devdb' || process.env.NODE_ENV === 'production') {
    throw new Error('테스트는 localhost/devdb에서만 실행됩니다. 운영 Cloud SQL DATABASE_URL을 거부했습니다.')
  }
}

requireLocalTestDatabase()
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'local-test-jwt-secret'
process.env.TOSS_WEBHOOK_SECRET = ''

const solapi = require('../src/solapi')
const notificationCalls = []
for (const method of [
  'sendReservationAlimtalk',
  'sendQueueTurnAlimtalk',
  'sendReceiptAlimtalk',
  'sendPromoAlimtalk',
]) {
  solapi[method] = async (payload) => {
    notificationCalls.push({ method, payload })
    return { ok: true }
  }
}

const { prisma, claimDuePromotions } = require('../src/store')
const { hashPassword, signAdminToken } = require('../src/auth')
const { app } = require('../server')

const testSerial = (name, fn) => test(name, { concurrency: false }, fn)

let sequence = 0
function unique(prefix) {
  sequence += 1
  return `${prefix}-${Date.now()}-${sequence}`
}

async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "RateLimitHit", "WebhookEvent", "Payment", "Reservation", "QueueCounter", "AdminUser", "Store" RESTART IDENTITY CASCADE'
  )
  notificationCalls.length = 0
}

async function createStore(label) {
  return prisma.store.create({
    data: {
      merchantId: unique(`merchant-${label}`),
      name: `테스트 매장 ${label}`,
    },
  })
}

async function waitFor(read, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('비동기 처리 결과를 제한 시간 안에 확인하지 못했습니다.')
}

async function postWebhook(webhookId, payment) {
  return request(app)
    .post('/api/webhooks/toss/payment')
    .set('x-toss-webhook-id', webhookId)
    .send({ type: payment.type, data: { payment: payment.data } })
}

before(async () => {
  await prisma.$queryRaw`SELECT 1`
  await resetDatabase()
})

beforeEach(resetDatabase)

after(async () => {
  await prisma.$disconnect()
})

testSerial('관리자 로그인은 짧은 시간 안에 설정된 limit을 초과하면 429를 반환한다', async () => {
  const ip = '198.51.100.10'
  const responses = []
  for (let attempt = 0; attempt < 11; attempt += 1) {
    responses.push(
      await request(app)
        .post('/api/admin/login')
        .set('X-Forwarded-For', ip)
        .send({ email: 'missing-admin@example.test', password: 'wrong-password' })
    )
  }

  assert.deepEqual(responses.slice(0, 10).map((response) => response.status), Array(10).fill(401))
  assert.equal(responses[10].status, 429)
})

testSerial('승인 웹훅은 Payment를 만들고 알림톡을 호출하지 않으며 중복은 건너뛴다', async () => {
  const store = await createStore('webhook-approved')
  const paymentKey = unique('order')
  const webhookId = unique('webhook')
  const payment = {
    type: 'payment.payment.approved.v1',
    data: { orderId: paymentKey, merchantId: store.merchantId, amount: '12000' },
  }

  const first = await postWebhook(webhookId, payment)
  assert.equal(first.status, 200)
  const recorded = await waitFor(() => prisma.payment.findUnique({ where: { paymentKey } }))
  assert.equal(recorded.storeId, store.id)
  assert.equal(recorded.amount, 12000)
  assert.equal(recorded.phone, null)
  assert.equal(notificationCalls.length, 0)

  const duplicate = await postWebhook(webhookId, payment)
  assert.equal(duplicate.status, 200)
  assert.equal(duplicate.body.skipped, 'duplicate')
  assert.equal(await prisma.payment.count({ where: { paymentKey } }), 1)
  assert.equal(notificationCalls.length, 0)
})

testSerial('취소 웹훅은 기존 Payment 상태를 cancelled로 변경한다', async () => {
  const store = await createStore('webhook-cancelled')
  const paymentKey = unique('order')
  const existing = await prisma.payment.create({
    data: {
      storeId: store.id,
      paymentKey,
      phone: '01012345678',
      status: 'requested',
      promoAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  })

  const response = await postWebhook(unique('webhook'), {
    type: 'payment.payment.cancelled.v1',
    data: { orderId: paymentKey, merchantId: store.merchantId },
  })
  assert.equal(response.status, 200)
  const cancelled = await waitFor(async () => {
    const record = await prisma.payment.findUnique({ where: { id: existing.id } })
    return record?.status === 'cancelled' ? record : null
  })
  assert.equal(cancelled.status, 'cancelled')
})

testSerial('store_admin은 다른 매장의 예약을 호출·완료·삭제할 수 없다', async () => {
  const ownStore = await createStore('scope-own')
  const otherStore = await createStore('scope-other')
  const admin = await prisma.adminUser.create({
    data: {
      email: `${unique('store-admin')}@example.test`,
      passwordHash: await hashPassword('test-password-123'),
      role: 'store_admin',
      storeId: ownStore.id,
    },
  })
  const reservation = await prisma.reservation.create({
    data: {
      storeId: otherStore.id,
      carNumber: '12가3456',
      phone: '01012345678',
      serviceType: '정비',
      queueNumber: 1,
      status: 'waiting',
    },
  })
  const authorization = `Bearer ${signAdminToken(admin)}`

  const call = await request(app).post(`/api/reservations/${reservation.id}/call`).set('Authorization', authorization)
  const complete = await request(app)
    .post(`/api/reservations/${reservation.id}/complete`)
    .set('Authorization', authorization)
  const remove = await request(app).delete(`/api/reservations/${reservation.id}`).set('Authorization', authorization)

  assert.equal(call.status, 403)
  assert.equal(complete.status, 403)
  assert.equal(remove.status, 403)
  const untouched = await prisma.reservation.findUnique({ where: { id: reservation.id } })
  assert.equal(untouched.status, 'waiting')
})

testSerial('전화번호가 null 또는 빈 문자열인 결제는 프로모션 클레임에서 제외된다', async () => {
  const store = await createStore('promotion')
  const dueAt = new Date(Date.now() - 60 * 1000)
  const missing = await prisma.payment.create({
    data: { storeId: store.id, phone: null, promoAt: dueAt },
  })
  const blank = await prisma.payment.create({
    data: { storeId: store.id, phone: '', promoAt: dueAt },
  })
  const valid = await prisma.payment.create({
    data: { storeId: store.id, phone: '01012345678', promoAt: dueAt },
  })

  const claimed = await claimDuePromotions()
  assert.deepEqual(claimed.map((payment) => payment.id), [valid.id])
  assert.equal((await prisma.payment.findUnique({ where: { id: missing.id } })).promoClaimedAt, null)
  assert.equal((await prisma.payment.findUnique({ where: { id: blank.id } })).promoClaimedAt, null)
})
