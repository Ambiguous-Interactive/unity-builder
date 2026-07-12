# Ambiguous Interactive fork maintenance

This fork adds a fail-closed `resourceSafe` output for Windows Unity builds. The
activation-owning container writes a nonce-bound proof through a unique
runner-temporary mount only when Unity's return command exits successfully. The
host removes that mount after every attempt and reports `false` for missing,
malformed, stale, skipped, interrupted, or otherwise uncertain cleanup. The
Unity build exit code remains authoritative.

The proof authenticates lifecycle sequencing, not hostile code running inside
the activation-owning container. The return script removes any earlier proof
immediately before invoking Unity, but a deliberately malicious background
process in the same trusted build container could still race the writer. Never
provide Unity credentials to untrusted pull-request code.

Consumers must pin an immutable `vX.Y.Z-resource-safe.N` tag or its commit SHA.
The `main` branch and the upstream-sync branch are not production references.

`Upstream Sync` runs every six hours and on demand. It compares the official
`game-ci/unity-builder` default branch with `UPSTREAM_COMMIT`:

- Documentation/license/image-only changes get a candidate PR. Trusted policy
  from the fork's default branch verifies the cleanup contract, runs the full
  upstream test/lint/typecheck/build suite, and checks generated `dist` before a
  fresh privileged job may merge the exact candidate SHA.
- Every source, dependency, lockfile, action, workflow, configuration, or
  generated-file change stays unconsumed and opens or updates one tracking issue
  with the upstream comparison, conflict probe, affected paths, contract IDs,
  and reproduction/remediation commands.

After manually adapting a review-required upstream update, update
`UPSTREAM_COMMIT`, run `node scripts/verify-resource-cleanup-contract.mjs .`,
regenerate `dist`, complete the full upstream validation suite, and publish a
new immutable fork tag after the Windows cleanup canary passes.
