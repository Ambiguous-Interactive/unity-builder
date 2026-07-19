$ErrorActionPreference = 'Stop'

$headers = @{
  Accept = 'application/vnd.github+json'
  Authorization = "Bearer $env:GH_TOKEN"
  'X-GitHub-Api-Version' = '2022-11-28'
}
$pullRequest = Invoke-RestMethod -Uri $env:PULL_REQUEST_API_URL -Headers $headers -TimeoutSec 30
$eligible = $pullRequest.state -eq 'open' -and
  $pullRequest.base.ref -eq $env:EXPECTED_BASE_REF -and
  $pullRequest.head.repo.full_name -eq $env:EXPECTED_HEAD_REPOSITORY -and
  $pullRequest.head.sha -eq $env:EXPECTED_HEAD_SHA
if (-not $eligible) {
  throw "Refusing licensed work for stale, closed, or ineligible PR revision $env:EXPECTED_HEAD_SHA."
}
