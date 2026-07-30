# Session 001 - enrollment remediation

**Branch:** `agent/issue-113-retire-untrusted-licensed-ci`
**Issue:** Ambiguous-Interactive/ambiguous-organization-build-lock#113

## The fork no longer claims cleanup for unsupported activation contexts

The organization enrollment contract accepts cleanup only from the approved
central return action. That action resolves and verifies one signed Windows
editor under `runner.tool_cache/u6-v3/<literal-version>`. The former Windows
workflow activated variable Unity versions inside Docker containers, so a
host-side return would attest a different editor and licensing context. The
former macOS jobs were also outside the Windows-only return contract.

Rather than manufacture a green cleanup tuple, this fork now runs only the
existing Windows and macOS cleanup proof fixtures. Each workflow has one
hosted, always-reporting aggregate and no organization Unity or build-lock
credentials. The action's Docker and native macOS return implementations,
typed outputs, private evidence fixtures, and production tests remain intact.

## Fail-closed evidence

- The resource cleanup verifier retains its runtime and action-contract checks
  and requires the complete, exact two-step fixture and one-step aggregate
  shapes. A counterfactual third macOS step makes RC020 fail.
- Both platform workflows retain literal `cancel-in-progress: false`, read-only
  permissions, the current immutable checkout v7.0.1 pin, and aggregates that
  fail when their fixture job is not successful.
- `yarn test:workflow-policy` passes all 10 policy tests.
- `yarn node scripts/verify-resource-cleanup-contract.mjs .` reports
  `Resource cleanup contract verified (RC001-RC020)`.

The exact branch head must still pass the central enrollment audit, independent
review, repository CI, and post-merge default-branch audit.
