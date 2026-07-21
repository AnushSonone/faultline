$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$env:FAULTLINE_ADDR = if ($env:FAULTLINE_ADDR) { $env:FAULTLINE_ADDR } else { "127.0.0.1:8080" }

Write-Host "Starting faultlined on http://$($env:FAULTLINE_ADDR)"
$daemon = Start-Process -PassThru -NoNewWindow cargo -ArgumentList @("run","-p","faultlined")
Start-Sleep -Seconds 4
try {
  $health = Invoke-RestMethod -Uri "http://$($env:FAULTLINE_ADDR)/api/v1/health"
  Write-Host ($health | ConvertTo-Json -Compress)
  Write-Host "Skeleton demo ready. Run: cd web; npm run dev"
  Write-Host "Press Enter to stop."
  Read-Host | Out-Null
} finally {
  Stop-Process -Id $daemon.Id -Force -ErrorAction SilentlyContinue
}
