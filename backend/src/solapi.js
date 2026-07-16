const { SolapiMessageService } = require('solapi')

let service = null
function getService() {
  if (!service) {
    service = new SolapiMessageService(
      process.env.SOLAPI_API_KEY,
      process.env.SOLAPI_API_SECRET
    )
  }
  return service
}

// 카카오 알림톡용 pfId/템플릿ID가 아직 없으면(템플릿 승인 전) 일반 문자(SMS/LMS)로 대신 보낸다.
// 알림톡 템플릿이 승인되고 .env에 SOLAPI_KAKAO_PFID + 템플릿ID를 채우면 자동으로 알림톡으로 전환된다.
async function sendAlimtalk({ phone, text, templateId, variables }) {
  const pfId = process.env.SOLAPI_KAKAO_PFID
  const useKakao = Boolean(pfId && templateId)

  const result = await getService().send({
    to: phone,
    from: process.env.SOLAPI_SENDER,
    text,
    ...(useKakao
      ? { kakaoOptions: { pfId, templateId, variables, disableSms: true } }
      : {}),
  })

  const failed = result?.failedMessageList ?? result?.failed
  if (failed?.length) {
    const firstErr = failed[0]
    const msg = firstErr?.resultMessage ?? firstErr?.statusMessage ?? firstErr?.reason ?? JSON.stringify(firstErr)
    throw new Error(msg)
  }
  console.log(`[solapi] ${useKakao ? '알림톡' : '문자(SMS)'} 발송 성공: ${phone}`)
  return result
}

// 예약 접수 완료 (대기번호 발급)
async function sendReservationAlimtalk({ phone, carNumber, queueNumber }) {
  return sendAlimtalk({
    phone,
    text: `[예약 접수]\n차량번호 ${carNumber}로 예약이 접수되었습니다. 대기번호 ${queueNumber}번`,
    templateId: process.env.SOLAPI_KAKAO_TEMPLATE_RESERVATION,
    variables: {
      '#{차량번호}': carNumber,
      '#{전화번호}': phone,
      '#{대기번호}': String(queueNumber),
    },
  })
}

// 순서가 되어 고객을 호출할 때
async function sendQueueTurnAlimtalk({ phone, carNumber, queueNumber }) {
  return sendAlimtalk({
    phone,
    text: `[순서 안내]\n${queueNumber}번, 고객님의 순서입니다. (차량번호 ${carNumber})`,
    templateId: process.env.SOLAPI_KAKAO_TEMPLATE_QUEUE_TURN,
    variables: {
      '#{차량번호}': carNumber,
      '#{대기번호}': String(queueNumber),
    },
  })
}

// 결제 완료 전자영수증
async function sendReceiptAlimtalk({ phone, carNumber, amount }) {
  const amountText = amount != null ? `${Number(amount).toLocaleString('ko-KR')}원` : ''
  return sendAlimtalk({
    phone,
    text: `[전자영수증]\n결제가 완료되었습니다.${carNumber ? `\n차량번호 ${carNumber}` : ''}${amountText ? `\n결제금액 ${amountText}` : ''}`,
    templateId: process.env.SOLAPI_KAKAO_TEMPLATE_RECEIPT,
    variables: {
      '#{차량번호}': carNumber || '',
      '#{결제금액}': amountText,
    },
  })
}

// 결제 3개월 후 자동 홍보 알림톡
async function sendPromoAlimtalk({ phone, carNumber }) {
  return sendAlimtalk({
    phone,
    text: `[안내]\n그동안 이용해주셔서 감사합니다. 지금 다시 방문하시면 혜택을 드립니다.`,
    templateId: process.env.SOLAPI_KAKAO_TEMPLATE_PROMO,
    variables: {
      '#{차량번호}': carNumber || '',
    },
  })
}

module.exports = {
  sendReservationAlimtalk,
  sendQueueTurnAlimtalk,
  sendReceiptAlimtalk,
  sendPromoAlimtalk,
}
