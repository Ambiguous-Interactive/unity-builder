$ErrorActionPreference = 'Stop'
$attemptedBuilds = 0
$resourceSafe = 'true'

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
    $resourceSafe = 'false'
}

$result = "resource-safe=${resourceSafe}"
if ([string]::IsNullOrWhiteSpace($env:GITHUB_OUTPUT)) {
    Write-Output $result
}
else {
    Add-Content -LiteralPath $env:GITHUB_OUTPUT -Value $result -Encoding utf8
}
