require('dotenv').config()
const express = require('express')
const cors = require('cors')
const rateLimit = require('express-rate-limit')
const cron = require('node-cron')
const path = require('node:path')
const {
  createReservation,
  listReservations,
  getNextWaitingReservation,
  markReservationCalled,
  createPayment,
  findPaymentByKey,
  listPayments,
  listDuePromotions,
  markPromoSent,
} = require('./src/store')
const {
  sendQueueTurnAlimtalk,
  sendReceiptAlimtalk,
  sendPromoAlimtalk,
} = require('./src/solapi')

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const CAR_NUMBER_RE = /^\d{2,3}[가-힣]\d{4}$/
const PHONE_RE = /^01[0-9]{8,9}$/

function requireAdmin(req, res, next) {
  const token = process.env.ADMIN_TOKEN
  if (!token || req.get('x-admin-token') !== token) {
    return res.status(401).json({ ok: false, error: 'unauthorized' })
  }
  next()
}

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

// --- 예약(대기순번) ---
// 차량번호 + 전화번호를 등록하고 대기번호를 발급한다.
// 알림톡은 여기서 바로 보내지 않고, 매장에서 순서를 호출할 때(/api/queue/call-next) 발송한다.
app.post('/api/reservations', reservationLimiter, async (req, res) => {
  try {
    const carNumber = String(req.body?.carNumber ?? '').trim()
    const phone = String(req.body?.phone ?? '').replace(/-/g, '').trim()

    if (!CAR_NUMBER_RE.test(carNumber)) {
      return res.status(400).json({ ok: false, error: '차량번호 형식이 올바르지 않습니다. 예) 12가3456' })
    }
    if (!PHONE_RE.test(phone)) {
      return res.status(400).json({ ok: false, error: '전화번호 형식이 올바르지 않습니다.' })
    }

    const reservation = createReservation({ carNumber, phone })
    return res.json({ ok: true, id: reservation.id, queueNumber: reservation.queueNumber })
  } catch (e) {
    console.error('reservation error:', e)
    return res.status(500).json({ ok: false, error: e.message })
  }
})

// 매장에서 다음 대기 고객을 호출한다 (관리자 전용). 대기중인 첫 건에 알림톡 발송.
app.post('/api/queue/call-next', requireAdmin, async (req, res) => {
  const reservation = getNextWaitingReservation()
  if (!reservation) {
    return res.status(404).json({ ok: false, error: '대기중인 예약이 없습니다.' })
  }

  markReservationCalled(reservation.id)

  try {
    await sendQueueTurnAlimtalk({
      phone: reservation.phone,
      carNumber: reservation.carNumber,
      queueNumber: reservation.queueNumber,
    })
  } catch (notifyError) {
    console.error(`순서 알림톡 발송 실패 [예약 id=${reservation.id}]:`, notifyError.message)
    reservation.status = 'notify_failed'
  }

  return res.json({ ok: true, id: reservation.id, queueNumber: reservation.queueNumber, status: reservation.status })
})

// 알림톡 발송 실패 건 확인용 (임시).
app.get('/api/reservations/failed', requireAdmin, (req, res) => {
  const failed = listReservations().filter((r) => r.status === 'notify_failed')
  return res.json({ ok: true, count: failed.length, reservations: failed })
})

// --- 결제 (전자영수증 + 3개월 후 프로모션) ---
// paymentKey(토스프론트 sdk.payment.requestPayment 호출 시 발급한 값)를 함께 보내면
// 같은 결제건에 대해 클라이언트가 재시도해도 영수증이 중복 발송되지 않는다.
app.post('/api/payments', paymentLimiter, async (req, res) => {
  try {
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

    const existing = findPaymentByKey(paymentKey)
    if (existing) {
      return res.json({ ok: true, id: existing.id })
    }

    const payment = createPayment({ paymentKey, carNumber: carNumberRaw || null, phone, amount })

    try {
      await sendReceiptAlimtalk({ phone, carNumber: payment.carNumber, amount: payment.amount })
      payment.status = 'receipt_sent'
    } catch (notifyError) {
      console.error(`전자영수증 발송 실패 [결제 id=${payment.id}]:`, notifyError.message)
      payment.status = 'receipt_failed'
      // 영수증 발송에 실패해도 결제/DB 적재 자체는 성공으로 처리한다
    }

    return res.json({ ok: true, id: payment.id })
  } catch (e) {
    console.error('payment error:', e)
    return res.status(500).json({ ok: false, error: e.message })
  }
})

app.get('/api/payments/failed', requireAdmin, (req, res) => {
  const failed = listPayments().filter((p) => p.status === 'receipt_failed')
  return res.json({ ok: true, count: failed.length, payments: failed })
})

async function sendDuePromotions() {
  const due = listDuePromotions()
  for (const payment of due) {
    try {
      await sendPromoAlimtalk({ phone: payment.phone, carNumber: payment.carNumber })
      markPromoSent(payment.id)
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
app.listen(PORT, () => console.log(`쉐보레 토스플러그인 서버 실행 중: http://localhost:${PORT}`))

module.exports = { app, sendDuePromotions }
