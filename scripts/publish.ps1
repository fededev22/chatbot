param([Parameter(Mandatory=$true)][string]$Message)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $projectRoot
function Run-Git {
  param([string[]]$Arguments)
  $result = & git @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Git no pudo completar: $($Arguments[0])." }
  return $result
}
$repoRoot = Run-Git -Arguments @('rev-parse','--show-toplevel')
if ([IO.Path]::GetFullPath($repoRoot) -ne $projectRoot) { throw 'Esta carpeta no es la raíz del repositorio esperado.' }
$remoteUrl = Run-Git -Arguments @('remote','get-url','origin')
if ($remoteUrl -notmatch '^https://github\.com/fededev22/chatbot(?:\.git)?$') { throw 'El remoto origin debe apuntar al repositorio fededev22/chatbot autorizado en GitHub.' }
$branch = Run-Git -Arguments @('branch','--show-current')
if ([string]::IsNullOrWhiteSpace($branch)) { throw 'La carpeta debe estar en una rama antes de publicar.' }
if ([string]::IsNullOrWhiteSpace($Message)) { throw 'Indicá una descripción del cambio.' }
function Assert-PublicFiles {
  foreach ($path in (Run-Git -Arguments @('ls-files'))) {
    if ($path -match '(^|/)(data|\.tools|\.vercel|node_modules)/|(^|/)\.env($|\.)|\.(sqlite|db|pem|key|p12|pfx)(-|$)|^docs/.*\.png$') {
      if ($path -ne '.env.example') { throw "Hay un archivo privado rastreado por Git: $path. Revisalo antes de publicar." }
    }
  }
}
Assert-PublicFiles
& npm test
if ($LASTEXITCODE -ne 0) { throw 'Las pruebas fallaron; no se publicó ningún cambio.' }
Run-Git -Arguments @('fetch','origin') | Out-Null
& git show-ref --verify --quiet "refs/remotes/origin/$branch"
if ($LASTEXITCODE -eq 0) {
  & git merge-base --is-ancestor "origin/$branch" HEAD
  if ($LASTEXITCODE -ne 0) { throw 'El remoto tiene cambios nuevos. Integralos antes de publicar; no se hará force push.' }
}
Run-Git -Arguments @('add','--all','--','.') | Out-Null
Assert-PublicFiles
$secretFiles = & git grep --cached -I -l -E -- '(EA[A-Za-z0-9]{35,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{35,}|nvapi-[A-Za-z0-9_-]{30,}|sk-or-v1-[A-Za-z0-9_-]{30,}|sk-proj-[A-Za-z0-9_-]{30,}|AIza[A-Za-z0-9_-]{30,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|^(WHATSAPP_TOKEN|META_APP_SECRET|WEBHOOK_VERIFY_TOKEN|ADMIN_TOKEN)=.+$)'
if ($LASTEXITCODE -eq 0) { throw "Posibles credenciales en archivos preparados: $($secretFiles -join ', '). Revisalos antes de publicar." }
if ($LASTEXITCODE -ne 1) { throw 'No se pudo completar la revisión de credenciales.' }
& git diff --cached --quiet
if ($LASTEXITCODE -eq 1) { Run-Git -Arguments @('commit','-m',$Message) | Out-Null }
elseif ($LASTEXITCODE -ne 0) { throw 'No se pudieron revisar los cambios preparados.' }
Run-Git -Arguments @('push','--set-upstream','origin',$branch)
Write-Output 'Cambios sincronizados con GitHub.'
