$ErrorActionPreference = 'Stop'

$pluginDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$distDir = Join-Path $pluginDir 'dist'
$zipPath = Join-Path $pluginDir 'chevrolet-pos-plugin.zip'
$stageDir = Join-Path $pluginDir '.package-pos-plugin'

Push-Location $pluginDir
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) {
    throw "POS 플러그인 빌드 실패(exit code: $LASTEXITCODE)"
  }
}
finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $distDir -PathType Container)) {
  throw 'dist 폴더가 생성되지 않았습니다.'
}
if (Test-Path -LiteralPath $stageDir) {
  Remove-Item -LiteralPath $stageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $stageDir | Out-Null

try {
  foreach ($file in Get-ChildItem -LiteralPath $distDir -Force) {
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $stageDir $file.Name) -Recurse
  }
  if (-not (Get-ChildItem -LiteralPath $stageDir -Force)) {
    throw 'dist 폴더가 비어 있어 ZIP을 만들 수 없습니다.'
  }
  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }
  Compress-Archive -Path (Join-Path $stageDir '*') -DestinationPath $zipPath -CompressionLevel Optimal
  Write-Output "생성 완료: $zipPath"
  Write-Output 'ZIP 내용: index.html, iframe-manifest.json, bundle.js'
}
finally {
  if (Test-Path -LiteralPath $stageDir) {
    Remove-Item -LiteralPath $stageDir -Recurse -Force
  }
}
