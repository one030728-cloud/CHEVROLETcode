// 로컬 브라우저 개발용 오버라이드.
//
// 2026-08-03 재검토(실제 브라우저 통합 테스트로 발견): "함수가 없을 때만 채운다"는 예전 가정이 틀렸다.
// CDN의 실제 toss-front-sdk(`https://cdn.tossplace.com/toss-front-sdk/v0/index.js`)는 실제 단말기가
// 아닌 일반 브라우저에서 열어도 `sdk.app.getMerchant()`를 이미 자체적으로 정의해두고 있고,
// 그 상태에서는 `{ id: -1, name: '토스 프론트 플러그인 매장', businessNumber: '0000000000' }` 같은
// 더미 값을 반환한다(실제 단말기 온보딩 전 플레이스홀더로 보인다). 그 결과 `if (!sdk.app.getMerchant)`
// 가드가 항상 false가 되어 아래 오버라이드가 전혀 적용되지 않았고, 로컬 미리보기에서 예약/결제 요청이
// merchantId=-1로 나가 서버가 매번 404("등록되지 않은 가맹점입니다")를 반환했다 — 즉 로컬 미리보기가
// 실제로는 한 번도 끝까지 성공한 적이 없었다(이전에 "확인했다"고 한 테스트는 이 SDK를 거치지 않고
// 서버 API를 직접 호출한 것이었다).
//
// 그래서 함수 존재 여부가 아니라 **호스트명**으로 "로컬/미리보기 환경인지"를 판단한다
// (pos-plugin/src/app.js의 isPreview와 같은 패턴). 실제 단말기에서는 이 호스트명에 해당하지 않으므로
// 이 오버라이드가 적용되지 않고 토스프론트가 제공하는 진짜 함수가 그대로 쓰인다.
var sdk = window.TossFrontSDK

if (!sdk.app) sdk.app = {}

var isPreview = /^(localhost|127\.0\.0\.1|chevroletcode\.onrender\.com)$/.test(location.hostname)

if (isPreview) {
  sdk.app.getMerchant = async () => ({
    id: '0',
    name: '쉐보레 대리점 (테스트)',
    businessNumber: '0000000000',
  })
  sdk.app.getSerialNumber = async () => ({ serialNumber: '000000000000000' })
}
