# Concatenate src/*.js into the single-file userscript, optionally run self-tests.
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1 -Test
# (PowerShell 7 also works: pwsh -File .\build.ps1 -Test)
# Keep this file ASCII-only: Windows PowerShell 5.1 parses .ps1 as ANSI without a BOM.
param([switch]$Test)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$srcDir = Join-Path $root 'src'
$outFile = Join-Path $root 'bili-medal-autopilot.user.js'
$enc = New-Object System.Text.UTF8Encoding($false)


# ---------- 1. version consistency check ----------
$baseFile = Join-Path $srcDir '01-base.js'
if (-not (Test-Path $baseFile)) { throw 'src/01-base.js not found' }
$baseText = [System.IO.File]::ReadAllText($baseFile, $enc)

$mHeader = [regex]::Match($baseText, '@version\s+(\d+\.\d+\.\d+)')
$mConst = [regex]::Match($baseText, "VERSION\s*=\s*'(\d+\.\d+\.\d+)'")
$verHeader = ''
$verConst = ''
if ($mHeader.Success) { $verHeader = $mHeader.Groups[1].Value }
if ($mConst.Success) { $verConst = $mConst.Groups[1].Value }
if (-not $verHeader) { throw '@version not found in src/01-base.js' }
if (-not $verConst) { throw 'VERSION constant not found in src/01-base.js' }
if ($verHeader -ne $verConst) {
    throw "Version mismatch: @version=$verHeader but VERSION=$verConst"
}

$verChangelog = ''
$changelogFile = Join-Path $root 'CHANGELOG.md'
if (Test-Path $changelogFile) {
    $changelogText = [System.IO.File]::ReadAllText($changelogFile, $enc)
    $mChangelog = [regex]::Match($changelogText, '(?m)^##\s*\[?(\d+\.\d+\.\d+)')
    if ($mChangelog.Success) { $verChangelog = $mChangelog.Groups[1].Value }
}
if ($verChangelog -and $verChangelog -ne $verConst) {
    throw "CHANGELOG top version ($verChangelog) does not match VERSION ($verConst)"
}

Write-Host ("[build] version {0}" -f $verConst) -ForegroundColor Cyan

# ---------- 2. concat ----------
$parts = Get-ChildItem -LiteralPath $srcDir -Filter '*.js' |
    Where-Object { $_.Name -notlike '_*' } |
    Sort-Object Name

if (-not $parts) { throw 'No source chunks found in src/' }

$sb = New-Object System.Text.StringBuilder
foreach ($p in $parts) {
    [void]$sb.Append([System.IO.File]::ReadAllText($p.FullName, $enc))
    [void]$sb.Append("`n")
}
[System.IO.File]::WriteAllText($outFile, $sb.ToString(), $enc)

$size = (Get-Item $outFile).Length
$lines = ([System.IO.File]::ReadAllText($outFile, $enc) -split "`n").Count
Write-Host ("[build] {0} chunks -> {1}" -f $parts.Count, (Split-Path -Leaf $outFile)) -ForegroundColor Green
Write-Host ("[build] {0:N0} bytes / {1} lines" -f $size, $lines)

# ---------- 3. optional self-test ----------
if ($Test) {
    $node = $null
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $node = $cmd.Source }
    if (-not $node) {
        $fallback = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
        if (Test-Path $fallback) { $node = $fallback }
    }
    if (-not $node) { throw 'node not found; run test/_test.js manually' }
    & $node (Join-Path $root 'test\_test.js')
    if ($LASTEXITCODE -ne 0) { throw "Self-test failed (exit $LASTEXITCODE)" }
    Write-Host '[build] Self-test passed' -ForegroundColor Green
}
