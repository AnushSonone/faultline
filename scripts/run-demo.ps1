$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$env:FAULTLINE_ADDR = if ($env:FAULTLINE_ADDR) { $env:FAULTLINE_ADDR } else { "127.0.0.1:8080" }
$env:FAULTLINE_FIXTURES = Join-Path $Root "datasets\fixtures"

Write-Host "Starting faultlined on http://$($env:FAULTLINE_ADDR)"
$daemon = Start-Process -PassThru -NoNewWindow cargo -ArgumentList @("run","-p","faultlined")
Start-Sleep -Seconds 5
try {
  $health = Invoke-RestMethod -Uri "http://$($env:FAULTLINE_ADDR)/api/v1/health"
  Write-Host ($health | ConvertTo-Json -Compress)
  Write-Host "Starting web (npm run dev)..."
  $web = Start-Process -PassThru -NoNewWindow npm -ArgumentList @("run","dev") -WorkingDirectory (Join-Path $Root "web")
  Start-Sleep -Seconds 3
  Write-Host "Demo ready:"
  Write-Host "  API  http://$($env:FAULTLINE_ADDR)/api/v1/health"
  Write-Host "  UI   http://127.0.0.1:5173"
  Write-Host "Press Enter to stop."
  Read-Host | Out-Null
  Stop-Process -Id $web.Id -Force -ErrorAction SilentlyContinue
} finally {
  Stop-Process -Id $daemon.Id -Force -ErrorAction SilentlyContinue
}
