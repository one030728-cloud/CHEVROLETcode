// 실제 토스프론트 단말기에서는 이 파일의 placeholder를 빌드 시
// CHEVROLET_API_BASE_URL 환경변수로 치환한다.
// 백엔드가 제공하는 로컬/Cloud Run 미리보기에서는 같은 origin을 사용한다.
(() => {
  const configuredApiBaseUrl = 'https://chevrolet-api-amib56yomq-du.a.run.app'
  const isLocalPreview = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  const isBackendPreview = location.pathname.startsWith('/toss-plugin/')
  window.CHEVROLET_API_BASE_URL = isLocalPreview || isBackendPreview
    ? ''
    : configuredApiBaseUrl.replace(/\/$/, '')
})()
