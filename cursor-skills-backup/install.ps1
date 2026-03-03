# 一鍵安裝 Cursor Skills（Windows）
# 在 cursor-skills-backup 目錄下執行: .\install.ps1

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TargetDir = Join-Path $env:USERPROFILE ".cursor\skills"

if (-not (Test-Path $TargetDir)) {
    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
}

Copy-Item -Recurse -Force (Join-Path $ScriptDir "commit-and-push-dev") $TargetDir
Copy-Item -Recurse -Force (Join-Path $ScriptDir "release-to-main") $TargetDir

Write-Host "✅ Skills 已安裝到 $TargetDir" -ForegroundColor Green
Write-Host ""
Write-Host "已安裝："
Write-Host "  - commit-and-push-dev"
Write-Host "  - release-to-main"
Write-Host ""
Write-Host "請重啟 Cursor 或開啟新對話，即可使用。"
