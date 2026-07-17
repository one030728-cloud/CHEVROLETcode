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
  getReservation,
  deleteReservation,
  markReservationCalled,
  markReservationCompleted,
  findLatestReservationByPhone,
  createPayment,
  findPaymentByKey,
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

const app = express()
app.use(cors())
app.use(express.json())
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

// 대기중인 예약을 호출 처리하고 "순서입니다" 알림톡을 보낸다.
// /api/queue/call-next(관리자가 수동 호출)와 예약 접수 시 대기인원이 0명이라 바로 호출되는 경우 둘 다에서 쓴다.
async function notifyQueueTurn(reservation) {
  markReservationCalled(reservation.id)
  try {
    await sendQueueTurnAlimtalk({
      phone: reservation.phone,
      carNumber: reservation.carNumber,
      queueNumber: reservation.queueNumber,
      serviceType: reservation.serviceType,
    })
  } catch (notifyError) {
    console.error(`순서 알림톡 발송 실패 [예약 id=${reservation.id}]:`, notifyError.message)
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
app.post('/api/reservations', reservationLimiter, async (req, res) => {
  try {
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

    const peopleAhead = listReservations().filter((r) => r.status !== 'completed').length
    const reservation = createReservation({ carNumber, phone, serviceType })

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
app.post('/api/queue/call-next', requireAdmin, async (req, res) => {
  const reservation = getNextWaitingReservation()
  if (!reservation) {
    return res.status(404).json({ ok: false, error: '대기중인 예약이 없습니다.' })
  }

  await notifyQueueTurn(reservation)

  return res.json({ ok: true, id: reservation.id, queueNumber: reservation.queueNumber, status: reservation.status })
})

// 특정 예약을 대기열 순서와 무관하게 바로 호출한다 (관리자 전용).
// 테스트로 만든 예약을 확인하거나, 예외적으로 순서를 건너뛰어야 할 때 쓴다.
app.post('/api/reservations/:id/call', requireAdmin, async (req, res) => {
  const reservation = getReservation(req.params.id)
  if (!reservation) {
    return res.status(404).json({ ok: false, error: '예약을 찾을 수 없습니다.' })
  }
  if (reservation.status !== 'waiting') {
    return res.status(400).json({ ok: false, error: '대기중인 예약만 호출할 수 있습니다.' })
  }

  await notifyQueueTurn(reservation)

  return res.json({ ok: true, id: reservation.id, queueNumber: reservation.queueNumber, status: reservation.status })
})

// 예약을 삭제한다 (관리자 전용). 테스트 데이터 정리나 손님 취소 처리용.
app.delete('/api/reservations/:id', requireAdmin, (req, res) => {
  const deleted = deleteReservation(req.params.id)
  if (!deleted) {
    return res.status(404).json({ ok: false, error: '예약을 찾을 수 없습니다.' })
  }
  return res.json({ ok: true })
})

// 정비가 끝났음을 표시한다 (관리자 전용). 이걸 눌러야 이 손님이 "앞에 있는 사람" 계산에서 빠져서
// 다음 예약이 자동 호출되거나 대기인원 안내에서 한 명 줄어든다.
app.post('/api/reservations/:id/complete', requireAdmin, (req, res) => {
  const reservation = markReservationCompleted(req.params.id)
  if (!reservation) {
    return res.status(404).json({ ok: false, error: '예약을 찾을 수 없습니다.' })
  }
  return res.json({ ok: true, id: reservation.id, status: reservation.status })
})

// 예약 전체 목록 (관리자 화면용, 최신순).
app.get('/api/reservations', requireAdmin, (req, res) => {
  const all = [...listReservations()].reverse()
  return res.json({ ok: true, count: all.length, reservations: all })
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
      return res.json({ ok: true, id: existing.id, carNumber: existing.carNumber, serviceType: existing.serviceType })
    }

    // 결제 화면에서 차량번호를 다시 입력받는 대신, 전화번호로 이 손님의 예약 기록을 찾아
    // 차량번호/정비항목을 그대로 가져다 쓴다. 예약 없이 바로 결제하는 손님(연결된 예약이 없는 경우)만
    // 클라이언트가 보낸 carNumber를 fallback으로 쓴다.
    const linkedReservation = findLatestReservationByPhone(phone)
    const carNumber = linkedReservation?.carNumber || carNumberRaw || null
    const serviceType = linkedReservation?.serviceType || null

    const payment = createPayment({ paymentKey, carNumber, serviceType, phone, amount })

    try {
      await sendReceiptAlimtalk({
        phone,
        carNumber: payment.carNumber,
        serviceType: payment.serviceType,
        amount: payment.amount,
      })
      payment.status = 'receipt_sent'
    } catch (notifyError) {
      console.error(`전자영수증 발송 실패 [결제 id=${payment.id}]:`, notifyError.message)
      payment.status = 'receipt_failed'
      // 영수증 발송에 실패해도 결제/DB 적재 자체는 성공으로 처리한다
    }

    return res.json({ ok: true, id: payment.id, carNumber: payment.carNumber, serviceType: payment.serviceType })
  } catch (e) {
    console.error('payment error:', e)
    return res.status(500).json({ ok: false, error: e.message })
  }
})

// 결제 전체 목록 (관리자 화면용, 최신순).
app.get('/api/payments', requireAdmin, (req, res) => {
  const all = [...listPayments()].reverse()
  return res.json({ ok: true, count: all.length, payments: all })
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
