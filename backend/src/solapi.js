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

function kakaoOptions(variables) {
  const pfId = process.env.SOLAPI_KAKAO_PFID
  const templateId = process.env.SOLAPI_KAKAO_TEMPLATE_RESERVATION
  if (!pfId || !templateId) {
    throw new Error(`알림톡 환경변수 누락: pfId=${!!pfId} templateId=${!!templateId}`)
  }
  return { pfId, templateId, variables, disableSms: true }
}

async function sendReservationAlimtalk({ phone, carNumber }) {
  const result = await getService().send({
    to: phone,
    from: process.env.SOLAPI_SENDER,
    text: `[예약 접수]\n차량번호 ${carNumber}로 예약이 접수되었습니다.`,
    kakaoOptions: kakaoOptions({
      '#{차량번호}': carNumber,
      '#{전화번호}': phone,
    }),
  })

  const failed = result?.failedMessageList ?? result?.failed
  if (failed?.length) {
    const firstErr = failed[0]
    const msg = firstErr?.resultMessage ?? firstErr?.statusMessage ?? firstErr?.reason ?? JSON.stringify(firstErr)
    throw new Error(msg)
  }
  return result
}

module.exports = { sendReservationAlimtalk }
