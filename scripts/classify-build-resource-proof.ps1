$ErrorActionPreference = 'Stop'
$attemptedBuilds = 0
$resourceSafe = 'true'
$resourceReason = 'cleanup-confirmed'

foreach ($attempt in 1..3) {
    $outcome = [Environment]::GetEnvironmentVariable("BUILD_${attempt}_OUTCOME")
    $attemptResourceSafe = [Environment]::GetEnvironmentVariable("BUILD_${attempt}_RESOURCE_SAFE")
    if (-not [string]::IsNullOrWhiteSpace($outcome) -and $outcome -ne 'skipped') {
        $attemptedBuilds++
        if ($attemptResourceSafe -ne 'true') {
            $resourceSafe = 'false'
        }
    }
}

if ($attemptedBuilds -eq 0) {
    if ($env:POST_ACQUIRE_HEAD_OUTCOME -in @('failure', 'cancelled')) {
        # The exact-head guard runs after lock admission and before the first
        # activation-owning action, so rejection here cannot leave a Unity seat.
        $resourceSafe = 'true'
        $resourceReason = 'no-activation-current-head-rejected'
    }
    else {
        $resourceSafe = 'false'
        $resourceReason = 'no-activation-proof'
    }
}
elseif ($resourceSafe -ne 'true') {
    $resourceReason = 'return-missing-positive-evidence'
}

$results = @("resource-safe=${resourceSafe}", "resource-reason=${resourceReason}")
if ([string]::IsNullOrWhiteSpace($env:GITHUB_OUTPUT)) {
    Write-Output $results
}
else {
    Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value $results -Encoding utf8
}
