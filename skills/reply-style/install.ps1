# Copy the reply-style rules into a project for non-Claude AI tools.
param(
  [Parameter(Mandatory=$true)][string]$Project,
  [string]$Tools = "agents,copilot,gemini,cursor"
)
$ErrorActionPreference = "Stop"
$src = Join-Path $PSScriptRoot "AGENTS.md"
if (-not (Test-Path $Project)) { throw "no such project dir: $Project" }
$body = [System.IO.File]::ReadAllText($src, [System.Text.Encoding]::UTF8)
$want = $Tools.Split(",") | ForEach-Object { $_.Trim().ToLower() }

function Write-Rule($path, $text) {
  $dir = Split-Path $path -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "wrote $path"
}

if ($want -contains "agents")  { Write-Rule (Join-Path $Project "AGENTS.md") $body }
if ($want -contains "gemini")  { Write-Rule (Join-Path $Project "GEMINI.md") $body }
if ($want -contains "copilot") { Write-Rule (Join-Path $Project ".github\copilot-instructions.md") $body }
if ($want -contains "cursor")  { Write-Rule (Join-Path $Project ".cursor\rules\reply-style.mdc") "---`ndescription: reply style`nalwaysApply: true`n---`n`n$body" }
if ($want -contains "windsurf"){ Write-Rule (Join-Path $Project ".windsurf\rules\reply-style.md") $body }
if ($want -contains "cline")   { Write-Rule (Join-Path $Project ".clinerules\reply-style.md") $body }
