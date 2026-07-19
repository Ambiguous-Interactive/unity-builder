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

$classifier = Join-Path $PSScriptRoot 'classify-build-resource-proof.ps1'
$allowedResourceReasons = @(
    'cleanup-confirmed',
    'cleanup-evidence-unknown',
    'return-missing-positive-evidence'
)
$classificationCases = @(
    @{ Name = 'no attempt'; Outcomes = @('skipped', 'skipped', 'skipped'); Proofs = @('', '', ''); Guard = 'skipped'; ExpectedSafe = 'false'; ExpectedReason = 'cleanup-evidence-unknown' },
    @{ Name = 'stale after admission'; Outcomes = @('skipped', 'skipped', 'skipped'); Proofs = @('', '', ''); Guard = 'failure'; ExpectedSafe = 'true'; ExpectedReason = 'cleanup-confirmed' },
    @{ Name = 'confirmed success'; Outcomes = @('success', 'skipped', 'skipped'); Proofs = @('true', '', ''); Guard = 'success'; ExpectedSafe = 'true'; ExpectedReason = 'cleanup-confirmed' },
    @{ Name = 'confirmed failed builds'; Outcomes = @('failure', 'failure', 'skipped'); Proofs = @('true', 'true', ''); Guard = 'success'; ExpectedSafe = 'true'; ExpectedReason = 'cleanup-confirmed' },
    @{ Name = 'failed return'; Outcomes = @('failure', 'skipped', 'skipped'); Proofs = @('false', '', ''); Guard = 'success'; ExpectedSafe = 'false'; ExpectedReason = 'return-missing-positive-evidence' },
    @{ Name = 'cancel after safe attempt'; Outcomes = @('failure', 'cancelled', 'skipped'); Proofs = @('true', '', ''); Guard = 'success'; ExpectedSafe = 'false'; ExpectedReason = 'return-missing-positive-evidence' }
)
foreach ($case in $classificationCases) {
    $outputPath = Join-Path ([System.IO.Path]::GetTempPath()) ("resource-proof-{0}.txt" -f [guid]::NewGuid())
    try {
        $env:GITHUB_OUTPUT = $outputPath
        foreach ($attempt in 1..3) {
            [Environment]::SetEnvironmentVariable("BUILD_${attempt}_OUTCOME", $case.Outcomes[$attempt - 1])
            [Environment]::SetEnvironmentVariable("BUILD_${attempt}_RESOURCE_SAFE", $case.Proofs[$attempt - 1])
        }
        $env:POST_ACQUIRE_HEAD_OUTCOME = $case.Guard
        & $classifier
        $actual = @{}
        foreach ($line in Get-Content -LiteralPath $outputPath) {
            $name, $value = $line -split '=', 2
            $actual[$name] = $value
        }
        if ($actual['resource-safe'] -ne $case.ExpectedSafe -or
            $actual['resource-reason'] -ne $case.ExpectedReason) {
            throw "Classifier case '$($case.Name)' expected $($case.ExpectedSafe)/$($case.ExpectedReason), got $($actual['resource-safe'])/$($actual['resource-reason'])."
        }
        if ($actual['resource-reason'] -notin $allowedResourceReasons) {
            throw "Classifier case '$($case.Name)' emitted a reason unsupported by pinned build-lock v1.8.3: $($actual['resource-reason'])."
        }
        if ($actual['resource-safe'] -eq 'true' -and $actual['resource-reason'] -ne 'cleanup-confirmed') {
            throw "Classifier case '$($case.Name)' violated the confirmed healthy cleanup reason contract."
        }
        if ($actual['resource-safe'] -ne 'true' -and $actual['resource-reason'] -eq 'cleanup-confirmed') {
            throw "Classifier case '$($case.Name)' used cleanup-confirmed without positive cleanup proof."
        }
    }
    finally {
        Remove-Item -LiteralPath $outputPath -Force -ErrorAction SilentlyContinue
    }
}

$activationScript = Join-Path $PSScriptRoot '..\dist\platforms\windows\activate.ps1'
$activationTokens = $null
$activationParseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
    $activationScript,
    [ref]$activationTokens,
    [ref]$activationParseErrors
) | Out-Null
if ($activationParseErrors.Count -ne 0) {
    throw "Windows activation script has parse errors: $($activationParseErrors.Message -join '; ')"
}

$activationCases = @(
    @{ Name = 'first attempt succeeds'; ExitCodes = @(0); ExpectedStarts = 1; ExpectedSleeps = @(); ExpectedExit = 0 },
    @{ Name = 'cooldown retry succeeds'; ExitCodes = @(1, 0); ExpectedStarts = 2; ExpectedSleeps = @(360); ExpectedExit = 0 },
    @{ Name = 'bounded retry fails'; ExitCodes = @(1, 1); ExpectedStarts = 2; ExpectedSleeps = @(360); ExpectedExit = 1 }
)
$savedSerial = $env:UNITY_SERIAL
$savedEmail = $env:UNITY_EMAIL
$savedPassword = $env:UNITY_PASSWORD
$savedUnityPath = $env:UNITY_PATH
try {
    $env:UNITY_SERIAL = 'synthetic-serial'
    $env:UNITY_EMAIL = 'synthetic@example.invalid'
    $env:UNITY_PASSWORD = 'synthetic-password'
    $env:UNITY_PATH = 'C:\synthetic-unity'

    foreach ($case in $activationCases) {
        $script:activationExitCodes = $case.ExitCodes
        $script:activationStartCount = 0
        $script:activationSleeps = @()
        function Start-Process {
            param($FilePath, [switch]$NoNewWindow, [switch]$PassThru, $ArgumentList)
            $exitCode = $script:activationExitCodes[$script:activationStartCount]
            $script:activationStartCount++
            [pscustomobject]@{ Handle = 1; HasExited = $true; ExitCode = $exitCode }
        }
        function Start-Sleep {
            param([int]$Seconds)
            $script:activationSleeps += $Seconds
        }

        . $activationScript

        if ($script:activationStartCount -ne $case.ExpectedStarts -or
            $ACTIVATION_EXIT_CODE -ne $case.ExpectedExit -or
            (Compare-Object $script:activationSleeps $case.ExpectedSleeps)) {
            throw "Activation case '$($case.Name)' violated bounded cooldown retry semantics."
        }
    }
}
finally {
    Remove-Item Function:\Start-Process -ErrorAction SilentlyContinue
    Remove-Item Function:\Start-Sleep -ErrorAction SilentlyContinue
    $env:UNITY_SERIAL = $savedSerial
    $env:UNITY_EMAIL = $savedEmail
    $env:UNITY_PASSWORD = $savedPassword
    $env:UNITY_PATH = $savedUnityPath
}

Write-Host 'Windows resource cleanup proof AST contract passed.'
