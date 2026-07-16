require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('node:path')
const { createReservation } = require('./src/store')
const { sendReservationAlimtalk } = require('./src/solapi')

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const CAR_NUMBER_RE = /^\d{2,3}[가-힣]\d{4}$/
const PHONE_RE = /^01[0-9]{8,9}$/

app.post('/api/reservations', async (req, res) => {
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

    try {
      await sendReservationAlimtalk({ phone, carNumber })
    } catch (notifyError) {
      console.error('알림톡 발송 실패:', notifyError.message)
      reservation.status = 'notify_failed'
      // 알림톡 발송에 실패해도 예약 접수 자체는 성공으로 처리한다
    }

    return res.json({ ok: true, id: reservation.id })
  } catch (e) {
    console.error('reservation error:', e)
    return res.status(500).json({ ok: false, error: e.message })
  }
})

app.get('/healthz', (req, res) => res.send('ok'))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`쉐보레 토스플러그인 서버 실행 중: http://localhost:${PORT}`))
