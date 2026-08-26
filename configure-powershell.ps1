$ErrorActionPreference = 'Stop'

$beginMarker = '# BEGIN mp-review-cli'
$endMarker = '# END mp-review-cli'
$profileBlock = @"
$beginMarker
Remove-Item Alias:mp -Force -ErrorAction SilentlyContinue
function global:mp { & (Join-Path `$env:APPDATA 'npm\mp.cmd') @args }
$endMarker
"@

$documents = [Environment]::GetFolderPath('MyDocuments')
$profilePaths = @(
    (Join-Path $documents 'WindowsPowerShell\profile.ps1'),
    (Join-Path $documents 'PowerShell\profile.ps1')
)

foreach ($profilePath in $profilePaths) {
    $profileDirectory = Split-Path -Parent $profilePath
    if (-not (Test-Path -LiteralPath $profileDirectory)) {
        New-Item -ItemType Directory -Path $profileDirectory -Force | Out-Null
    }

    $existing = if (Test-Path -LiteralPath $profilePath) {
        Get-Content -LiteralPath $profilePath -Raw
    }
    else {
        ''
    }

    $pattern = '(?ms)^' + [regex]::Escape($beginMarker) + '.*?^' + [regex]::Escape($endMarker) + '\r?\n?'
    $withoutOldBlock = [regex]::Replace($existing, $pattern, '').TrimEnd()
    $newContent = if ($withoutOldBlock) {
        $withoutOldBlock + [Environment]::NewLine + [Environment]::NewLine + $profileBlock + [Environment]::NewLine
    }
    else {
        $profileBlock + [Environment]::NewLine
    }

    Set-Content -LiteralPath $profilePath -Value $newContent -Encoding UTF8
}

Write-Output 'PowerShell mp command configured.'
