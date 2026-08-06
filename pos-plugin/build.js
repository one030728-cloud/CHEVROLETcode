// @tossplace/pos-plugin-sdk는 npm 전용 패키지(ESM import)라 브라우저에서 바로 못 쓴다.
// "탭 화면(iframe) 패키지" 방식(https://docs.tossplace.com/guide/pos-integration/plugin/develop/iframe-package.html)이
// 요구하는 산출물(dist/에 index.html + iframe-manifest.json + 번들 JS)을 esbuild로 직접 만든다.
// 이 프로젝트에는 React 등 별도 프레임워크가 없어(백엔드도 순수 JS 스타일) 의도적으로 가장 단순한 구성으로 뒀다.
const esbuild = require('esbuild')
const fs = require('node:fs')
const path = require('node:path')

const watch = process.argv.includes('--watch')
const distDir = path.join(__dirname, 'dist')
const apiBaseUrl = String(process.env.CHEVROLET_API_BASE_URL || '').trim().replace(/\/$/, '')

fs.rmSync(distDir, { recursive: true, force: true })
fs.mkdirSync(distDir, { recursive: true })
fs.copyFileSync(path.join(__dirname, 'public', 'index.html'), path.join(distDir, 'index.html'))
fs.copyFileSync(path.join(__dirname, 'public', 'iframe-manifest.json'), path.join(distDir, 'iframe-manifest.json'))

const options = {
  entryPoints: [path.join(__dirname, 'src', 'app.js')],
  bundle: true,
  outfile: path.join(distDir, 'bundle.js'),
  format: 'iife',
  target: 'es2018',
  minify: !watch,
  sourcemap: watch,
  define: {
    __CHEVROLET_API_BASE_URL__: JSON.stringify(apiBaseUrl),
  },
}

if (watch) {
  esbuild.context(options).then((ctx) => {
    ctx.watch()
    console.log('[pos-plugin] watching for changes...')
  })
} else {
  esbuild.build(options).then(() => {
    console.log('[pos-plugin] build complete -> dist/')
  })
}
