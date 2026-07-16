// 임시 인메모리 저장소. 서버가 재시작되면 데이터가 사라집니다.
// 나중에 실제 DB(Supabase 등)로 교체할 때는 이 파일의 함수 시그니처만 유지하면 됩니다.
// 특히 promoAt으로 미래 발송을 예약하는 프로모션 알림톡은 서버 재시작 시 유실되면 안 되므로
// DB 교체가 최우선 순위입니다 (README "다음 단계" 참고).

const { randomUUID } = require('node:crypto')

const reservations = []
const payments = []

let dailyQueueCounter = 0
let dailyQueueDate = null

function nextQueueNumber() {
  const today = new Date().toISOString().slice(0, 10)
  if (dailyQueueDate !== today) {
    dailyQueueDate = today
    dailyQueueCounter = 0
  }
  dailyQueueCounter += 1
  return dailyQueueCounter
}

function createReservation({ carNumber, phone }) {
  const reservation = {
    id: randomUUID(),
    carNumber,
    phone,
    queueNumber: nextQueueNumber(),
    status: 'waiting', // waiting -> called (알림톡 발송 완료) / notify_failed
    createdAt: new Date().toISOString(),
    calledAt: null,
  }
  reservations.push(reservation)
  return reservation
}

function listReservations() {
  return reservations
}

function getNextWaitingReservation() {
  return reservations.find((r) => r.status === 'waiting') ?? null
}

function markReservationCalled(id) {
  const reservation = reservations.find((r) => r.id === id)
  if (!reservation) return null
  reservation.status = 'called'
  reservation.calledAt = new Date().toISOString()
  return reservation
}

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000

function findPaymentByKey(paymentKey) {
  if (!paymentKey) return null
  return payments.find((p) => p.paymentKey === paymentKey) ?? null
}

function createPayment({ paymentKey, carNumber, phone, amount }) {
  const now = new Date()
  const payment = {
    id: randomUUID(),
    paymentKey: paymentKey || null,
    carNumber: carNumber || null,
    phone,
    amount: amount ?? null,
    status: 'requested', // requested -> receipt_sent / receipt_failed
    promoAt: new Date(now.getTime() + THREE_MONTHS_MS).toISOString(),
    promoSent: false,
    promoSentAt: null,
    createdAt: now.toISOString(),
  }
  payments.push(payment)
  return payment
}

function listPayments() {
  return payments
}

function listDuePromotions() {
  const now = Date.now()
  return payments.filter((p) => !p.promoSent && new Date(p.promoAt).getTime() <= now)
}

function markPromoSent(id) {
  const payment = payments.find((p) => p.id === id)
  if (!payment) return null
  payment.promoSent = true
  payment.promoSentAt = new Date().toISOString()
  return payment
}

module.exports = {
  createReservation,
  listReservations,
  getNextWaitingReservation,
  markReservationCalled,
  createPayment,
  findPaymentByKey,
  listPayments,
  listDuePromotions,
  markPromoSent,
}
