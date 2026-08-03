$ErrorActionPreference = 'Stop'

$pluginDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$zipPath = Join-Path $pluginDir 'chevrolet-front-plugin.zip'
$stageDir = Join-Path $pluginDir '.package-front-plugin'
$runtimeFiles = @(
  'index.html',
  'onboarding.html',
  'payment.html',
  'reservation.html',
  'sdk.js',
  'settings.html'
)

if (Test-Path -LiteralPath $stageDir) {
  Remove-Item -LiteralPath $stageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $stageDir | Out-Null

try {
  foreach ($file in $runtimeFiles) {
    $source = Join-Path $pluginDir $file
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
      throw "배포 파일이 없습니다: $file"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $stageDir $file)
  }

  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }
  Compress-Archive -Path (Join-Path $stageDir '*') -DestinationPath $zipPath -CompressionLevel Optimal
  Write-Output "생성 완료: $zipPath"
  Write-Output 'ZIP 내용: index.html, onboarding.html, payment.html, reservation.html, sdk.js, settings.html'
}
finally {
  if (Test-Path -LiteralPath $stageDir) {
    Remove-Item -LiteralPath $stageDir -Recurse -Force
  }
}
