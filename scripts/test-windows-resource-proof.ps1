$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot '..\dist\platforms\windows\return_license.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $scriptPath,
    [ref]$tokens,
    [ref]$parseErrors
)
if ($parseErrors.Count -ne 0) {
    throw "Windows return script has parse errors: $($parseErrors.Message -join '; ')"
}

$source = Get-Content -LiteralPath $scriptPath -Raw
$removeIndex = $source.IndexOf('Remove-Item -LiteralPath $env:UNITY_BUILDER_RESOURCE_PROOF_PATH')
$returnIndex = $source.IndexOf('$RETURN_LICENSE_OUTPUT = Start-Process')
if ($removeIndex -lt 0 -or $returnIndex -lt 0 -or $removeIndex -ge $returnIndex) {
    throw 'Current-attempt proof must be removed immediately before Unity return starts.'
}
foreach ($required in @(
        '[DateTime]::UtcNow.AddSeconds(120)',
        '-ErrorAction Stop',
        '$RETURN_LICENSE_OUTPUT.Kill()',
        'license return monitoring failed',
        'license return could not be started'
    )) {
    if (-not $source.Contains($required)) {
        throw "Bounded/non-masking return contract is missing: $required"
    }
}

$successIf = $ast.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.IfStatementAst] -and
        $node.Clauses.Count -gt 0 -and
        $node.Clauses[0].Item1.Extent.Text -match '\$RETURN_LICENSE_EXIT_CODE\s+-eq\s+0'
    }, $true) | Select-Object -First 1
if ($null -eq $successIf) {
    throw 'Could not find the successful Unity return branch.'
}
$successBody = $successIf.Clauses[0].Item2.Extent.Text
foreach ($required in @(
        '[System.IO.File]::WriteAllText(',
        '$env:UNITY_BUILDER_RESOURCE_PROOF_PATH',
        '"resource-safe=$env:UNITY_BUILDER_RESOURCE_PROOF_NONCE"',
        'catch'
    )) {
    if (-not $successBody.Contains($required)) {
        throw "Successful return branch is missing: $required"
    }
}
if ($successIf.ElseClause.Extent.Text.Contains('WriteAllText')) {
    throw 'Failed return branch must never persist resource-safe proof.'
}

$entrypoint = Get-Content -LiteralPath (
    Join-Path $PSScriptRoot '..\dist\platforms\windows\entrypoint.ps1'
) -Raw
$buildIndex = $entrypoint.IndexOf('. "c:\steps\build.ps1"')
$cleanupIndex = $entrypoint.IndexOf('. "c:\steps\return_license.ps1"')
$exitIndex = $entrypoint.IndexOf('exit $BUILD_EXIT_CODE')
if ($buildIndex -lt 0 -or $cleanupIndex -le $buildIndex -or $exitIndex -le $cleanupIndex) {
    throw 'Entrypoint must preserve build -> cleanup -> BUILD_EXIT_CODE ordering.'
}

Write-Host 'Windows resource cleanup proof AST contract passed.'
