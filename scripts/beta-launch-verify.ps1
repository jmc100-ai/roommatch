# TravelByVibe beta launch smoke checks (run after deploy).
# Usage: .\scripts\beta-launch-verify.ps1
# Optional: -BaseUrl https://www.travelbyvibe.com -GatePassword 'your-beta-password'

param(
  [string]$BaseUrl = "https://www.travelbyvibe.com",
  [string]$GatePassword = ""
)

$BaseUrl = $BaseUrl.TrimEnd("/")
Write-Host "=== TravelByVibe beta verify: $BaseUrl ===" -ForegroundColor Cyan

function Get-Url($path, $headers = @{}) {
  $uri = "$BaseUrl$path"
  try {
    $params = @{ Uri = $uri; UseBasicParsing = $true; TimeoutSec = 30 }
    if ($headers.Count) { $params.Headers = $headers }
    return Invoke-WebRequest @params
  } catch {
    Write-Host "FAIL $uri : $($_.Exception.Message)" -ForegroundColor Red
    return $null
  }
}

$r = Get-Url "/api/health"
if ($r -and $r.Content -eq "ok") { Write-Host "OK  /api/health" -ForegroundColor Green }
else { Write-Host "BAD /api/health" -ForegroundColor Red }

$r = Get-Url "/api/health/beta"
if ($r) {
  $j = $r.Content | ConvertFrom-Json
  Write-Host "OK  /api/health/beta release=$($j.release)" -ForegroundColor Green
  $j.instrumentation | Format-List
} else {
  Write-Host "BAD /api/health/beta (401 = deploy latest code with allowlist, or gate mis-config)" -ForegroundColor Red
}

if ($GatePassword) {
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $auth = Invoke-WebRequest -Uri "$BaseUrl/auth" -Method POST -Body @{ password = $GatePassword } -WebSession $session -UseBasicParsing
  Write-Host "Gate auth: $($auth.StatusCode)" -ForegroundColor $(if ($auth.StatusCode -eq 200) { "Green" } else { "Yellow" })
  $home = Invoke-WebRequest -Uri "$BaseUrl/" -WebSession $session -UseBasicParsing
  Write-Host "App home after gate: $($home.StatusCode)" -ForegroundColor Green
}

Write-Host "`nManual (cannot automate): PostHog replay, Sentry->Linear, Resend invites." -ForegroundColor Yellow
