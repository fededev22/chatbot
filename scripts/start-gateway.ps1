$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskListener = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' } | Select-Object -First 1
if ($taskListener) {
  $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($taskListener.OwningProcess)"
  if ($taskProcess.CommandLine -notlike '*webhook-gateway.mjs*') { throw 'El puerto 3001 pertenece a otro programa.' }
  Stop-Process -Id $taskProcess.ProcessId
}
$taskNode = (Get-Command node).Source
$taskGateway = Start-Process -FilePath $taskNode -ArgumentList '--env-file-if-exists=.env','webhook-gateway.mjs' -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot 'data/gateway.log') -RedirectStandardError (Join-Path $taskRoot 'data/gateway-error.log') -PassThru
$taskGateway.Id | Set-Content -LiteralPath (Join-Path $taskRoot 'data/gateway.pid')
Write-Output 'Recepcion del webhook iniciada en segundo plano.'
