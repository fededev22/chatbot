$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $taskRoot 'data/server.pid'
if (Test-Path -LiteralPath $pidFile) {
  $taskServerPid = [int](Get-Content -LiteralPath $pidFile)
  $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$taskServerPid"
  if ($taskProcess) {
    if ($taskProcess.CommandLine -notlike '*server.mjs*') { throw 'El PID guardado no corresponde al servidor.' }
    Stop-Process -Id $taskServerPid
  }
}
$taskNode = (Get-Command node).Source
$taskServer = Start-Process -FilePath $taskNode -ArgumentList '--env-file-if-exists=.env','server.mjs' -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot 'data/server.log') -RedirectStandardError (Join-Path $taskRoot 'data/server-error.log') -PassThru
$taskServer.Id | Set-Content -LiteralPath $pidFile
Write-Output 'Servidor local reiniciado en segundo plano.'
