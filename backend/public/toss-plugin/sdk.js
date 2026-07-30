// 로컬 브라우저 개발용 오버라이드.
//
// 2026-07-30 재검토: 실제 토스플레이스 SDK 문서(https://docs.tossplace.com/reference/plugin-sdk/front/app.html)를
// 확인한 결과, 이전에 쓰던 `sdk.overrides({ merchant, serialNumber })`와 `sdk.merchant`/`sdk.serialNumber`
// 프로퍼티는 App API 문서에 존재하지 않는다. 실제 API는 App API의 비동기 함수
// `await sdk.app.getMerchant()` / `await sdk.app.getSerialNumber()`뿐이다 — 이전 코드로는 실제 단말기에서
// merchantId가 항상 undefined가 되어 모든 요청이 실패했을 것이다 (reservation.html/payment.html도 함께 수정함).
//
// 실제 단말기에서는 토스프론트가 sdk.app.getMerchant()/getSerialNumber()를 이미 구현해서 제공하므로,
// 아래 오버라이드는 "그 함수가 아직 없을 때만"(=단말기 없는 로컬 브라우저 미리보기) 채워 넣는다.
// 즉 실제 단말기에서는 이 파일이 아무 영향을 주지 않고, 로컬 미리보기에서만 테스트 매장 정보를 흉내낸다.
var sdk = window.TossFrontSDK

if (!sdk.app) sdk.app = {}

if (!sdk.app.getMerchant) {
  sdk.app.getMerchant = async () => ({
    id: '0',
    name: '쉐보레 대리점 (테스트)',
    businessNumber: '0000000000',
  })
}

if (!sdk.app.getSerialNumber) {
  sdk.app.getSerialNumber = async () => '000000000000000'
}
