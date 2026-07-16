// 로컬 브라우저 개발용 오버라이드. 실제 토스프론트 단말기에서는 무시되고
// 단말기에 온보딩된 실제 가맹점 정보가 사용된다.
// 참고: https://docs.tossplace.com/guide/front-integration/plugin/develop/develop-tutorial.html
var sdk = window.TossFrontSDK

sdk.overrides({
  serialNumber: '000000000000000',
  merchant: {
    id: 0,
    name: '쉐보레 대리점 (테스트)',
    businessNumber: '0000000000',
  },
})
