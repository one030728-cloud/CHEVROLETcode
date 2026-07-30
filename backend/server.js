require('dotenv').config()
const express = require('express')
const cors = require('cors')
const rateLimit = require('express-rate-limit')
const cron = require('node-cron')
const path = require('node:path')
const {
  ensureDefaultStore,
  ensureDefaultHqAdmin,
  bulkCreateStores,
  recordWebhookEventOnce,
  findAdminUserByEmail,
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
  listDuePromotions,
  markPromoSent,
} = require('./src/store')
const {
  sendReservationAlimtalk,
  sendQueueTurnAlimtalk,
  sendReceiptAlimtalk,
  sendPromoAlimtalk,
} = require('./src/solapi')
const { hashPassword, verifyPassword, signAdminToken, verifyAdminToken } = require('./src/auth')

// JWT_SECRET이 없으면(로컬 개발) 매 부팅마다 랜덤 값을 생성한다 — 서버를 재시작하면
// 이전 로그인 토큰은 전부 무효화되지만(재로그인 필요), 로컬 개발엔 문제없다.
// 운영 배포에서는 반드시 .env에 고정된 JWT_SECRET을 넣어야 한다.
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = require('node:crypto').randomBytes(32).toString('hex')
  console.warn('[auth] JWT_SECRET이 설정되지 않아 임시 값으로 발급합니다. 운영 배포 전 .env에 고정값을 지정하세요.')
}

const app = express()
app.use(cors())
// 웹훅 서명 검증(HMAC)은 재직렬화한 JSON이 아니라 원본 바이트가 필요해서, verify 훅으로
// req.rawBody에 원본을 남겨둔다 (POST /api/webhooks/toss/payment에서 사용).
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf } }))
app.use(express.static(path.join(__dirname, 'public')))

const CAR_NUMBER_RE = /^\d{2,3}[가-힣]\d{4}$/
const PHONE_RE = /^01[0-9]{8,9}$/

// 정비 항목 선택지. 토스프론트 플러그인의 reservation.html 선택 화면과 키/순서를 맞춰야 한다.
const SERVICE_TYPES = {
  oil: '엔진오일 교체',
  inspection: '정기점검',
  tire: '타이어 교체·펑크수리',
  battery: '배터리 교체',
  brake: '브레이크 정비',
  etc: '기타 수리·상담',
}

// Design Ref: docs/02-design/features/multi-store-support.design.md Phase 3
// ADMIN_TOKEN 공유 방식을 대체하는 JWT 인증. 토큰의 role/storeId 클레임을 req.admin에 담아
// 이후 미들웨어(requireRole)와 핸들러가 매장별 접근 범위를 판단하는 데 쓴다.
function requireAuth(req, res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) {
    return res.status(401).json({ ok: false, error: 'unauthorized' })
  }
  try {
    const payload = verifyAdminToken(token)
    req.admin = { id: payload.sub, role: payload.role, storeId: payload.storeId, email: payload.email }
    next()
  } catch {
    return res.status(401).json({ ok: false, error: 'unauthorized' })
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.admin.role)) {
      return res.status(403).json({ ok: false, error: '권한이 없습니다.' })
    }
    next()
  }
}

// store_admin은 쿼리파라미터로 어떤 storeId를 보내든 무시하고 자기 매장으로 강제 고정한다.
// hq_admin은 ?storeId= 쿼리를 그대로 쓰거나(특정 매장), 생략하면 전체 매장을 본다.
function resolveScopedStoreId(req) {
  if (req.admin.role === 'store_admin') return req.admin.storeId
  return String(req.query?.storeId ?? '').trim() || undefined
}

// call/complete/delete처럼 :id로 특정 예약을 조작하는 라우트에서, store_admin이 다른 매장의
// 예약을 건드리지 못하도록 막는다. hq_admin은 항상 통과.
function assertOwnsReservation(req, res, reservation) {
  if (req.admin.role === 'store_admin' && reservation.storeId !== req.admin.storeId) {
    res.status(403).json({ ok: false, error: '다른 매장의 예약입니다.' })
    return false
  }
  return true
}

// 토스 SDK가 단말기에서 넘겨주는 merchant.id를 우리 내부 store(가맹점) 레코드로 변환한다.
// 등록되지 않은 merchantId면(=본사가 아직 이 매장을 승인 안 함) null을 반환한다.
// 요청 바디의 merchantId를 필수로 강제해 여러 매장 데이터가 서로 섞이는 걸 서버단에서 막는다.
async function requireStore(req, res, next) {
  const merchantId = req.body?.merchantId ?? req.query?.merchantId
  if (merchantId === undefined || merchantId === null || merchantId === '') {
    return res.status(400).json({ ok: false, error: '가맹점 정보(merchantId)가 없습니다.' })
  }
  const store = await findStoreByMerchantId(merchantId)
  if (!store) {
    return res.status(404).json({ ok: false, error: '등록되지 않은 가맹점입니다.' })
  }
  if (store.status !== 'active') {
    return res.status(403).json({ ok: false, error: '비활성화된 가맹점입니다.' })
  }
  req.store = store
  next()
}

// --- 관리자 인증 ---
app.post('/api/admin/login', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: '이메일/비밀번호를 입력해주세요.' })
  }

  const admin = await findAdminUserByEmail(email)
  if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
    return res.status(401).json({ ok: false, error: '이메일 또는 비밀번호가 올바르지 않습니다.' })
  }

  await markAdminLogin(admin.id)
  const token = signAdminToken(admin)
  return res.json({ ok: true, token, role: admin.role, storeId: admin.storeId, email: admin.email })
})

// 로그인한 관리자 본인 정보 (역할/소속 매장). store_admin이 자기 매장의 merchantId를 알아야
// 테스트 예약 등록 같은 매장-스코프 액션을 할 수 있어서, 이 매장 조회는 role 제한 없이 허용한다.
app.get('/api/admin/me', requireAuth, async (req, res) => {
  let store = null
  if (req.admin.storeId) {
    store = await getStore(req.admin.storeId)
  }
  return res.json({ ok: true, id: req.admin.id, email: req.admin.email, role: req.admin.role, store })
})

// 매장 관리자 계정 발급 (본사 전용). merchantId로 매장을 찾아 그 매장에 스코프된 계정을 만든다.
app.post('/api/admin/store-admins', requireAuth, requireRole('hq_admin'), async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  const merchantId = String(req.body?.merchantId ?? '').trim()

  if (!email || !password || !merchantId) {
    return res.status(400).json({ ok: false, error: 'email/password/merchantId가 모두 필요합니다.' })
  }
  if (password.length < 8) {
    return res.status(400).json({ ok: false, error: '비밀번호는 8자 이상이어야 합니다.' })
  }
  const store = await findStoreByMerchantId(merchantId)
  if (!store) {
    return res.status(404).json({ ok: false, error: '등록되지 않은 가맹점입니다.' })
  }
  if (await findAdminUserByEmail(email)) {
    return res.status(409).json({ ok: false, error: '이미 등록된 이메일입니다.' })
  }

  const passwordHash = await hashPassword(password)
  const admin = await createAdminUser({ email, passwordHash, role: 'store_admin', storeId: store.id })
  return res.json({ ok: true, admin: { id: admin.id, email: admin.email, role: admin.role, storeId: admin.storeId } })
})

const reservationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
})

const paymentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
})

// 대기중인 예약을 호출 처리하고 "순서입니다" 알림톡을 보낸다.
// /api/queue/call-next(관리자가 수동 호출)와 예약 접수 시 대기인원이 0명이라 바로 호출되는 경우 둘 다에서 쓴다.
// DB 업데이트와 별개로, 호출부(server.js)가 응답 본문을 만들 때 쓰는 로컬 reservation 객체의
// status도 함께 갱신해준다 — 인메모리 시절엔 같은 객체를 참조해서 자동으로 반영됐지만
// Prisma는 매번 새 객체를 반환하므로 명시적으로 맞춰줘야 한다.
async function notifyQueueTurn(reservation) {
  await markReservationCalled(reservation.id)
  reservation.status = 'called'
  try {
    await sendQueueTurnAlimtalk({
      phone: reservation.phone,
      carNumber: reservation.carNumber,
      queueNumber: reservation.queueNumber,
      serviceType: reservation.serviceType,
      storeName: reservation.store?.name,
    })
  } catch (notifyError) {
    console.error(`순서 알림톡 발송 실패 [예약 id=${reservation.id}]:`, notifyError.message)
    await markReservationNotifyFailed(reservation.id)
    reservation.status = 'notify_failed'
  }
}

// --- 예약(대기순번) ---
// 차량번호 + 전화번호를 등록하고 대기번호를 발급한다.
// "앞에 몇 명 있는지"는 status가 'completed'가 아닌(=아직 정비가 안 끝난) 예약 수로 센다.
// 단순히 'waiting'만 세면, 이미 호출됐지만 아직 정비 중인 손님을 무시하고 계속 자동 호출이 발생한다
// (정비 베이가 몇 개 비었는지는 모르니, 관리자가 /api/reservations/:id/complete로 "정비완료"를
// 눌러줘야 그 손님이 앞에서 빠진다).
// 앞에 아무도 없으면 곧바로 "순서입니다" 알림톡을 보내고, 있으면 "몇 명 남았는지"를 안내하는 접수 알림톡을 보낸다.
app.post('/api/reservations', reservationLimiter, requireStore, async (req, res) => {
  try {
    const storeId = req.store.id
    const carNumber = String(req.body?.carNumber ?? '').trim()
    const phone = String(req.body?.phone ?? '').replace(/-/g, '').trim()
    const serviceTypeKey = String(req.body?.serviceType ?? '').trim()

    if (!CAR_NUMBER_RE.test(carNumber)) {
      return res.status(400).json({ ok: false, error: '차량번호 형식이 올바르지 않습니다. 예) 12가3456' })
    }
    if (!PHONE_RE.test(phone)) {
      return res.status(400).json({ ok: false, error: '전화번호 형식이 올바르지 않습니다.' })
    }
    if (!SERVICE_TYPES[serviceTypeKey]) {
      return res.status(400).json({ ok: false, error: '정비 항목을 선택해주세요.' })
    }
    const serviceType = SERVICE_TYPES[serviceTypeKey]

    const currentReservations = await listReservations(storeId)
    const peopleAhead = currentReservations.filter((r) => r.status !== 'completed').length
    const reservation = await createReservation({ storeId, carNumber, phone, serviceType })
    reservation.store = req.store // notifyQueueTurn/알림톡에서 #{매장명}으로 쓰기 위해 붙여둔다

    if (peopleAhead === 0) {
      await notifyQueueTurn(reservation)
    } else {
      try {
        await sendReservationAlimtalk({
          phone,
          carNumber,
          queueNumber: reservation.queueNumber,
          peopleAhead,
          serviceType,
          storeName: req.store.name,
        })
      } catch (notifyError) {
        console.error(`예약 접수 알림 발송 실패 [예약 id=${reservation.id}]:`, notifyError.message)
        // 접수 안내 알림 발송에 실패해도 손님은 여전히 대기중이므로 status는 바꾸지 않는다.
      }
    }

    return res.json({
      ok: true,
      id: reservation.id,
      queueNumber: reservation.queueNumber,
      peopleAhead,
      serviceType: reservation.serviceType,
      status: reservation.status,
    })
  } catch (e) {
    console.error('reservation error:', e)
    return res.status(500).json({ ok: false, error: e.message })
  }
})

// 매장에서 다음 대기 고객을 호출한다 (관리자 전용). 대기중인 첫 건에 알림톡 발송.
// hq_admin은 ?storeId=를 지정해야 하고, store_admin은 자기 매장으로 자동 고정된다.
app.post('/api/queue/call-next', requireAuth, async (req, res) => {
  const storeId = resolveScopedStoreId(req)
  if (!storeId) {
    return res.status(400).json({ ok: false, error: 'storeId가 필요합니다.' })
  }
  const reservation = await getNextWaitingReservation(storeId)
  if (!reservation) {
    return res.status(404).json({ ok: false, error: '대기중인 예약이 없습니다.' })
  }

  await notifyQueueTurn(reservation)

  return res.json({ ok: true, id: reservation.id, queueNumber: reservation.queueNumber, status: reservation.status })
})

// 특정 예약을 대기열 순서와 무관하게 바로 호출한다 (관리자 전용).
// 테스트로 만든 예약을 확인하거나, 예외적으로 순서를 건너뛰어야 할 때 쓴다.
app.post('/api/reservations/:id/call', requireAuth, async (req, res) => {
  const reservation = await getReservation(req.params.id)
  if (!reservation) {
    return res.status(404).json({ ok: false, error: '예약을 찾을 수 없습니다.' })
  }
  if (!assertOwnsReservation(req, res, reservation)) return
  if (reservation.status !== 'waiting') {
    return res.status(400).json({ ok: false, error: '대기중인 예약만 호출할 수 있습니다.' })
  }

  await notifyQueueTurn(reservation)

  return res.json({ ok: true, id: reservation.id, queueNumber: reservation.queueNumber, status: reservation.status })
})

// 예약을 삭제한다 (관리자 전용). 테스트 데이터 정리나 손님 취소 처리용.
app.delete('/api/reservations/:id', requireAuth, async (req, res) => {
  const reservation = await getReservation(req.params.id)
  if (!reservation) {
    return res.status(404).json({ ok: false, error: '예약을 찾을 수 없습니다.' })
  }
  if (!assertOwnsReservation(req, res, reservation)) return
  await deleteReservation(req.params.id)
  return res.json({ ok: true })
})

// 정비가 끝났음을 표시한다 (관리자 전용). 이걸 눌러야 이 손님이 "앞에 있는 사람" 계산에서 빠져서
// 다음 예약이 자동 호출되거나 대기인원 안내에서 한 명 줄어든다.
app.post('/api/reservations/:id/complete', requireAuth, async (req, res) => {
  const existing = await getReservation(req.params.id)
  if (!existing) {
    return res.status(404).json({ ok: false, error: '예약을 찾을 수 없습니다.' })
  }
  if (!assertOwnsReservation(req, res, existing)) return
  const reservation = await markReservationCompleted(req.params.id)
  return res.json({ ok: true, id: reservation.id, status: reservation.status })
})

// 예약 목록 (관리자 화면용, 최신순). hq_admin은 ?storeId=로 특정 매장 필터/생략시 전체,
// store_admin은 항상 자기 매장으로 고정된다.
app.get('/api/reservations', requireAuth, async (req, res) => {
  const storeId = resolveScopedStoreId(req)
  const all = (await listReservations(storeId)).reverse()
  return res.json({ ok: true, count: all.length, reservations: all })
})

// 알림톡 발송 실패 건 확인용 (임시).
app.get('/api/reservations/failed', requireAuth, async (req, res) => {
  const storeId = resolveScopedStoreId(req)
  const failed = (await listReservations(storeId)).filter((r) => r.status === 'notify_failed')
  return res.json({ ok: true, count: failed.length, reservations: failed })
})

// --- 결제 (전자영수증 + 3개월 후 프로모션) ---
// paymentKey(토스프론트 sdk.payment.requestPayment 호출 시 발급한 값)를 함께 보내면
// 같은 결제건에 대해 클라이언트가 재시도해도 영수증이 중복 발송되지 않는다.
app.post('/api/payments', paymentLimiter, requireStore, async (req, res) => {
  try {
    const storeId = req.store.id
    const paymentKey = String(req.body?.paymentKey ?? '').trim() || null
    const phone = String(req.body?.phone ?? '').replace(/-/g, '').trim()
    const carNumberRaw = String(req.body?.carNumber ?? '').trim()
    const amountRaw = req.body?.amount

    if (!PHONE_RE.test(phone)) {
      return res.status(400).json({ ok: false, error: '전화번호 형식이 올바르지 않습니다.' })
    }
    if (carNumberRaw && !CAR_NUMBER_RE.test(carNumberRaw)) {
      return res.status(400).json({ ok: false, error: '차량번호 형식이 올바르지 않습니다. 예) 12가3456' })
    }
    let amount = null
    if (amountRaw !== undefined && amountRaw !== null && amountRaw !== '') {
      amount = Number(amountRaw)
      if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({ ok: false, error: '결제금액이 올바르지 않습니다.' })
      }
    }

    const existing = await findPaymentByKey(paymentKey)
    if (existing) {
      return res.json({ ok: true, id: existing.id, carNumber: existing.carNumber, serviceType: existing.serviceType })
    }

    // 결제 화면에서 차량번호를 다시 입력받는 대신, 전화번호로 이 손님의 예약 기록을 찾아
    // 차량번호/정비항목을 그대로 가져다 쓴다. 같은 매장 안에서만 찾고, 예약 없이 바로 결제하는
    // 손님(연결된 예약이 없는 경우)만 클라이언트가 보낸 carNumber를 fallback으로 쓴다.
    const linkedReservation = await findLatestReservationByPhone(storeId, phone)
    const carNumber = linkedReservation?.carNumber || carNumberRaw || null
    const serviceType = linkedReservation?.serviceType || null

    const payment = await createPayment({ storeId, paymentKey, carNumber, serviceType, phone, amount })

    try {
      await sendReceiptAlimtalk({
        phone,
        carNumber: payment.carNumber,
        serviceType: payment.serviceType,
        amount: payment.amount,
        storeName: req.store.name,
      })
      await markPaymentStatus(payment.id, 'receipt_sent')
    } catch (notifyError) {
      console.error(`전자영수증 발송 실패 [결제 id=${payment.id}]:`, notifyError.message)
      await markPaymentStatus(payment.id, 'receipt_failed')
      // 영수증 발송에 실패해도 결제/DB 적재 자체는 성공으로 처리한다
    }

    return res.json({ ok: true, id: payment.id, carNumber: payment.carNumber, serviceType: payment.serviceType })
  } catch (e) {
    console.error('payment error:', e)
    return res.status(500).json({ ok: false, error: e.message })
  }
})

// 결제 목록 (관리자 화면용, 최신순). hq_admin은 ?storeId=로 필터/생략시 전체, store_admin은 자기 매장 고정.
app.get('/api/payments', requireAuth, async (req, res) => {
  const storeId = resolveScopedStoreId(req)
  const all = (await listPayments(storeId)).reverse()
  return res.json({ ok: true, count: all.length, payments: all })
})

app.get('/api/payments/failed', requireAuth, async (req, res) => {
  const storeId = resolveScopedStoreId(req)
  const failed = (await listPayments(storeId)).filter((p) => p.status === 'receipt_failed')
  return res.json({ ok: true, count: failed.length, payments: failed })
})

// --- 가맹점(매장) 관리 (본사 관리자 전용) ---
// 토스플레이스 개발자센터에서 발급된 merchant.id를 우리 store 레코드와 매핑해 등록한다.
// 등록해야만 그 매장의 플러그인에서 온 예약/결제 요청이 통과된다 (requireStore 참고).
app.get('/api/admin/stores', requireAuth, requireRole('hq_admin'), async (req, res) => {
  return res.json({ ok: true, stores: await listStores() })
})

app.post('/api/admin/stores', requireAuth, requireRole('hq_admin'), async (req, res) => {
  const merchantId = String(req.body?.merchantId ?? '').trim()
  const name = String(req.body?.name ?? '').trim()
  const businessNumber = String(req.body?.businessNumber ?? '').trim()

  if (!merchantId) {
    return res.status(400).json({ ok: false, error: 'merchantId가 필요합니다.' })
  }
  if (!name) {
    return res.status(400).json({ ok: false, error: '매장명이 필요합니다.' })
  }
  if (await findStoreByMerchantId(merchantId)) {
    return res.status(409).json({ ok: false, error: '이미 등록된 merchantId입니다.' })
  }

  const store = await createStore({ merchantId, name, businessNumber })
  return res.json({ ok: true, store })
})

// Design Ref: Phase 4 대량 온보딩. body: { stores: [{ merchantId, name, businessNumber? }, ...] }
// 항목별로 성공/실패를 나눠서 돌려준다 — 하나가 중복 merchantId라고 전체가 실패하지 않는다.
app.post('/api/admin/stores/bulk', requireAuth, requireRole('hq_admin'), async (req, res) => {
  const items = Array.isArray(req.body?.stores) ? req.body.stores : null
  if (!items || !items.length) {
    return res.status(400).json({ ok: false, error: 'stores 배열이 필요합니다.' })
  }
  if (items.length > 500) {
    return res.status(400).json({ ok: false, error: '한 번에 최대 500건까지 등록할 수 있습니다.' })
  }

  const results = await bulkCreateStores(items)
  const successCount = results.filter((r) => r.ok).length
  return res.json({ ok: true, successCount, failCount: results.length - successCount, results })
})

// --- 토스플레이스 결제 웹훅 (Phase 4, 백업 경로) ---
// payment.html이 결제 성공 후 클라이언트에서 직접 POST /api/payments를 호출하는 게 기본 경로다.
// 이 웹훅은 그 호출이 네트워크 문제 등으로 유실됐을 때를 대비한 보완 장치다.
// ⚠️ 실제 등록은 개발자센터에서 자체 설정이 안 되고 developer-support@tossplace.com에 문의해야 한다.
//
// 2026-07-30 재검토(https://docs.tossplace.com/reference/open-api/webhook.html,
// https://docs.tossplace.com/reference/open-api/payment.html)로 서명/페이로드 구조를 다음과 같이 확인·수정함:
// - 서명: HMAC-SHA256(key=TOSS_WEBHOOK_SECRET, message=`${x-toss-timestamp}.${원본 raw body}`),
//   hex 인코딩 후 `v1=` 접두사. x-toss-timestamp가 현재 시각과 너무 다르면 거부해야 한다.
// - payload: `{ id, type, createdAt, merchantId, app, data: { payment: {...} } }` 형태
//   (이전엔 `eventType`/`data.paymentKey`로 잘못 파싱하고 있었음).
// - ⚠️ 미해결: 문서에 확인된 payment 객체 필드(id/merchantId/orderId/amount/state 등)에는
//   `paymentKey`가 없다. 우리 쪽에서 client가 생성해 sdk.payment.requestPayment()에 넘기는
//   `paymentKey`가 이 payment 객체의 어느 필드(orderId? 다른 이름?)와 대응되는지 공개 문서로는
//   확인이 안 된다 — developer-support@tossplace.com에 직접 문의해서 확정해야 정확한 매칭이 가능하다.
//   그 전까지는 merchantId+금액 정도로만 참고 로그를 남기고, 자동으로 결제 레코드를 만들지는 않는다
//   (잘못된 매칭으로 엉뚱한 예약에 영수증을 보내는 것보다 안전한 선택).
app.post('/api/webhooks/toss/payment', async (req, res) => {
  const webhookId = req.get('x-toss-webhook-id')
  const signature = req.get('x-toss-signature')
  const timestamp = req.get('x-toss-timestamp')

  if (!webhookId) {
    return res.status(400).json({ ok: false, error: 'x-toss-webhook-id 헤더가 없습니다.' })
  }

  const secret = process.env.TOSS_WEBHOOK_SECRET
  if (secret) {
    if (!timestamp || !signature) {
      return res.status(400).json({ ok: false, error: 'x-toss-timestamp/x-toss-signature 헤더가 없습니다.' })
    }
    const crypto = require('node:crypto')
    const FIVE_MIN_MS = 5 * 60 * 1000
    const tsMs = Number(timestamp)
    if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > FIVE_MIN_MS) {
      console.error('[webhook] x-toss-timestamp가 허용 범위를 벗어남:', timestamp)
      return res.status(400).json({ ok: false, error: 'stale timestamp' })
    }

    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body)
    const message = `${timestamp}.${rawBody}`
    const expected = 'v1=' + crypto.createHmac('sha256', secret).update(message).digest('hex')

    const sigBuf = Buffer.from(signature)
    const expectedBuf = Buffer.from(expected)
    const validSignature =
      sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)
    if (!validSignature) {
      console.error('[webhook] 서명 검증 실패, webhookId=', webhookId)
      return res.status(401).json({ ok: false, error: 'invalid signature' })
    }
  } else {
    console.warn('[webhook] TOSS_WEBHOOK_SECRET 미설정 — 서명 검증 없이 수신 중 (운영 전 반드시 설정)')
  }

  // 토스 쪽 재전송에도 같은 이벤트를 두 번 처리하지 않도록 먼저 기록한다.
  const isNew = await recordWebhookEventOnce(webhookId, req.body?.type || 'unknown')
  if (!isNew) {
    return res.json({ ok: true, skipped: 'duplicate' })
  }

  // 웹훅은 빠르게 2xx를 돌려줘야 토스가 재시도를 안 한다 — 무거운 처리는 응답 이후로 미룬다.
  res.json({ ok: true })

  try {
    const eventType = req.body?.type
    const payment = req.body?.data?.payment || {}
    if (eventType === 'payment.payment.approved.v1') {
      // FR-08 미해결 사항(위 주석 참고): paymentKey 대응 필드가 확정되지 않아 자동 레코드 생성은 보류.
      // 지금은 "이런 결제 승인이 있었다"는 사실만 로그로 남겨 관리자가 대사(reconcile)할 수 있게 한다.
      console.warn(
        `[webhook] 결제 승인 수신: toss payment.id=${payment.id}, merchantId=${payment.merchantId}, ` +
          `orderId=${payment.orderId}, amount=${payment.amount} — paymentKey 매칭 필드 미확정으로 자동 처리 안 함.`
      )
    } else if (eventType === 'payment.payment.cancelled.v1') {
      console.warn(
        `[webhook] 결제 취소 수신: toss payment.id=${payment.id}, merchantId=${payment.merchantId}, ` +
          `orderId=${payment.orderId} — paymentKey 매칭 필드 미확정으로 자동 처리 안 함. 수동 확인 필요.`
      )
    } else {
      console.log('[webhook] 처리 대상 아닌 이벤트:', eventType)
    }
  } catch (e) {
    console.error('[webhook] 처리 중 오류:', e.message)
  }
})

async function sendDuePromotions() {
  const due = await listDuePromotions()
  for (const payment of due) {
    try {
      await sendPromoAlimtalk({ phone: payment.phone, carNumber: payment.carNumber, storeName: payment.store?.name })
      await markPromoSent(payment.id)
    } catch (notifyError) {
      console.error(`프로모션 알림톡 발송 실패 [결제 id=${payment.id}]:`, notifyError.message)
      // 실패 시 promoSent를 true로 바꾸지 않아 다음 스케줄 실행 때 재시도한다
    }
  }
}

// 매일 오전 10시, 결제일로부터 3개월이 지난 고객에게 홍보 알림톡을 자동 발송한다.
cron.schedule('0 10 * * *', sendDuePromotions)

app.get('/healthz', (req, res) => res.send('ok'))

const PORT = process.env.PORT || 3000
Promise.all([ensureDefaultStore(), ensureDefaultHqAdmin()])
  .then(() => {
    app.listen(PORT, () => console.log(`쉐보레 토스플러그인 서버 실행 중: http://localhost:${PORT}`))
  })
  .catch((e) => {
    console.error('부팅 시드 실패:', e.message)
    process.exit(1)
  })

module.exports = { app, sendDuePromotions }
