$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskCloudflare = Join-Path $taskRoot '.tools/cloudflared.exe'
if (!(Test-Path -LiteralPath $taskCloudflare)) { throw 'Falta el ejecutable oficial de Cloudflare en .tools.' }
$taskOld = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.ExecutablePath -eq $taskCloudflare -and $_.CommandLine -like '*http://127.0.0.1:3001*' }
foreach ($taskProcess in $taskOld) { Stop-Process -Id $taskProcess.ProcessId }
$taskOutput = Join-Path $taskRoot 'data/cloudflared.log'
$taskError = Join-Path $taskRoot 'data/cloudflared-error.log'
$taskTunnel = Start-Process -FilePath $taskCloudflare -ArgumentList 'tunnel','--no-autoupdate','--url','http://127.0.0.1:3001','--protocol','http2' -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput $taskOutput -RedirectStandardError $taskError -PassThru
$taskTunnel.Id | Set-Content -LiteralPath (Join-Path $taskRoot 'data/tunnel.pid')
Write-Output 'Túnel de webhook iniciado en segundo plano. La URL se registra en data/cloudflared-error.log.'
