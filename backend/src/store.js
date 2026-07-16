// 임시 인메모리 저장소. 서버가 재시작되면 데이터가 사라집니다.
// 나중에 실제 DB(Supabase 등)로 교체할 때는 이 파일의 함수 시그니처만 유지하면 됩니다.

const { randomUUID } = require('node:crypto')

const reservations = []

function createReservation({ carNumber, phone }) {
  const reservation = {
    id: randomUUID(),
    carNumber,
    phone,
    status: 'requested',
    createdAt: new Date().toISOString(),
  }
  reservations.push(reservation)
  return reservation
}

function listReservations() {
  return reservations
}

module.exports = { createReservation, listReservations }
