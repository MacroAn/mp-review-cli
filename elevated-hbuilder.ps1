param(
    [Parameter(Mandatory = $true)]
    [string]$RequestPath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$result = @{
    exitCode = 1
    output = ''
}

try {
    Set-Location -LiteralPath $request.cwd
    $cliPath = [string]$request.cliPath
    $publishArguments = @($request.arguments | ForEach-Object { [string]$_ })

    $helpOutput = (& $cliPath help 2>&1 | Out-String)
    if ($helpOutput -like '*未检测到已打开的HBuilderX*') {
        & $cliPath open 2>&1 | Out-Null
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        do {
            Start-Sleep -Seconds 1
            $helpOutput = (& $cliPath help 2>&1 | Out-String)
        } while ($helpOutput -like '*未检测到已打开的HBuilderX*' -and [DateTime]::UtcNow -lt $deadline)
    }

    if ($helpOutput -like '*未检测到已打开的HBuilderX*') {
        throw 'HBuilderX 未建立 CLI 连接'
    }

    $publishOutput = (& $cliPath @publishArguments 2>&1 | Out-String)
    $result.exitCode = $LASTEXITCODE
    $result.output = $publishOutput
}
catch {
    $result.exitCode = 1
    $result.output = $_.Exception.Message
}
finally {
    $resultJson = $result | ConvertTo-Json -Compress
    [IO.File]::WriteAllText([string]$request.resultPath, $resultJson, $utf8)
}

exit $result.exitCode
