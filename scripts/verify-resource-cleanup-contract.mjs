import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import {
  findCredentialShapedEnvLiterals,
  renderCredentialFinding,
} from './workflow-credential-policy.mjs';

const root = path.resolve(process.argv[2] || '.');
const failures = [];
const buildLockSha = '59a2fa98224569e5a697f271a3ac4b866c53ac2c';

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function requireText(id, relativePath, text) {
  if (!read(relativePath).includes(text))
    failures.push(`${id}: ${relativePath} is missing ${text}`);
}

function requireOrder(id, relativePath, snippets) {
  const source = read(relativePath);
  let position = -1;
  for (const snippet of snippets) {
    const next = source.indexOf(snippet, position + 1);
    if (next < 0) {
      failures.push(`${id}: ${relativePath} does not preserve ordered token ${snippet}`);
      return;
    }
    position = next;
  }
}

requireText('RC001', 'action.yml', 'resourceSafe:');
requireText('RC002', 'src/index.ts', 'await Output.setResourceSafe(false);');
requireOrder('RC003', 'src/index.ts', [
  'await Output.setResourceSafe(false);',
  'await BuildParameters.create()',
  'ResourceCleanupProof.begin',
  'Docker.run',
  'ResourceCleanupProof.consume',
]);
requireText(
  'RC004',
  'src/model/resource-cleanup-proof.ts',
  'nonceFactory: () => string = randomUUID',
);
requireText('RC004', 'src/model/resource-cleanup-proof.ts', 'const nonce = nonceFactory();');
requireText(
  'RC005',
  'src/model/resource-cleanup-proof.ts',
  "readFileSync(attempt.filePath, 'utf8') === `resource-safe=${attempt.nonce}`",
);
requireText(
  'RC010',
  'dist/platforms/windows/return_license.ps1',
  '[DateTime]::UtcNow.AddSeconds(120)',
);
requireText('RC010', 'dist/platforms/windows/return_license.ps1', '$RETURN_LICENSE_OUTPUT.Kill()');
requireText(
  'RC006',
  'src/model/resource-cleanup-proof.ts',
  "mkdtempSync(path.join(runnerTemp, 'unity-cleanup-proof-'))",
);
requireText('RC007', 'src/model/docker.ts', 'c:/unity-resource-proof');
requireText(
  'RC008',
  'src/model/image-environment-factory.ts',
  'UNITY_BUILDER_RESOURCE_PROOF_NONCE',
);
requireText('RC009', 'src/model/image-environment-factory.ts', 'UNITY_BUILDER_RESOURCE_PROOF_PATH');
requireOrder('RC010', 'dist/platforms/windows/return_license.ps1', [
  'Remove-Item -LiteralPath $env:UNITY_BUILDER_RESOURCE_PROOF_PATH',
  '$RETURN_LICENSE_OUTPUT = Start-Process',
  '$RETURN_LICENSE_EXIT_CODE -eq 0',
  '$env:UNITY_BUILDER_RESOURCE_PROOF_NONCE',
  '[System.IO.File]::WriteAllText(',
  '"resource-safe=$env:UNITY_BUILDER_RESOURCE_PROOF_NONCE"',
]);
requireText(
  'RC010',
  'dist/platforms/windows/return_license.ps1',
  'cleanup proof could not be persisted',
);
requireOrder('RC011', 'dist/platforms/windows/entrypoint.ps1', [
  '. "c:\\steps\\activate.ps1"',
  '. "c:\\steps\\build.ps1"',
  '. "c:\\steps\\return_license.ps1"',
  'exit $BUILD_EXIT_CODE',
]);
requireText('RC012', 'dist/index.js', 'UNITY_BUILDER_RESOURCE_PROOF_NONCE');
requireText('RC013', 'dist/index.js', 'resourceSafe');

const windowsWorkflow = parse(read('.github/workflows/build-tests-windows.yml'));
const windowsPreflight = windowsWorkflow.jobs?.['runner-preflight'];
const windowsJob = windowsWorkflow.jobs?.buildForAllPlatformsWindows;
const windowsSteps = windowsJob?.steps || [];
const windowsStepIndex = (id) => windowsSteps.findIndex((step) => step.id === id);
const windowsStep = (id) => windowsSteps.find((step) => step.id === id);
if (
  !Object.hasOwn(windowsWorkflow.on || {}, 'push') ||
  !Object.hasOwn(windowsWorkflow.on || {}, 'workflow_dispatch')
)
  failures.push('RC014: Windows workflow must retain push static checks and manual canaries');
if (windowsJob?.if !== "github.event_name == 'workflow_dispatch'")
  failures.push('RC014: licensed Windows matrix must be manual-only');
if (
  windowsPreflight?.if !== "github.event_name == 'workflow_dispatch'" ||
  windowsPreflight?.['runs-on'] !== 'ubuntu-latest' ||
  windowsPreflight?.steps?.[0]?.uses !==
    `Ambiguous-Interactive/ambiguous-organization-build-lock/.github/actions/check-unity-runner-availability@${buildLockSha}` ||
  windowsPreflight?.steps?.[0]?.with?.['reader-app-id'] !==
    '${{ secrets.BUILD_LOCK_READER_APP_ID }}' ||
  windowsPreflight?.steps?.[0]?.with?.['reader-app-private-key'] !==
    '${{ secrets.BUILD_LOCK_READER_APP_PRIVATE_KEY }}' ||
  windowsPreflight?.steps?.[0]?.with?.['required-label-sets'] !==
    '[["self-hosted","Windows","RAM-64GB"]]'
)
  failures.push('RC014: Windows canary must fail closed through the reader-App preflight');
if (
  windowsJob?.needs !== 'runner-preflight' ||
  JSON.stringify(windowsJob?.['runs-on']) !== JSON.stringify(['self-hosted', 'Windows', 'RAM-64GB'])
)
  failures.push('RC014: licensed Windows matrix must run only on the preflighted fleet');
if (windowsJob?.strategy?.['max-parallel'] !== 1)
  failures.push('RC014: licensed Windows matrix must admit only one runner at a time');
const expectedBuildConditions = [
  "${{ steps.acquire-build-lock.outputs.acquired == 'true' }}",
  "${{ steps.acquire-build-lock.outputs.acquired == 'true' && steps.build-1.outcome == 'failure' }}",
  "${{ steps.acquire-build-lock.outputs.acquired == 'true' && steps.build-1.outcome == 'failure' && steps.build-2.outcome == 'failure' }}",
];
if (
  [1, 2, 3].some(
    (attempt) => windowsStep(`build-${attempt}`)?.if !== expectedBuildConditions[attempt - 1],
  )
)
  failures.push('RC014: every licensed Windows attempt must require organization lock ownership');
const lifecycleIndices = [
  windowsStepIndex('acquire-build-lock'),
  windowsStepIndex('build-1'),
  windowsStepIndex('build-2'),
  windowsStepIndex('build-3'),
  windowsStepIndex('cleanup-proof'),
  windowsSteps.findIndex((step) => step.name === 'Release organization Unity lock'),
  windowsSteps.findIndex((step) => step.name === 'Verify activation-owning cleanup proof'),
];
if (
  lifecycleIndices.some((index) => index < 0) ||
  lifecycleIndices.some((index, offset) => offset > 0 && index <= lifecycleIndices[offset - 1])
)
  failures.push('RC014: Windows canary must order acquire, build, proof, and release');
if (
  windowsStep('acquire-build-lock')?.uses !==
    `Ambiguous-Interactive/ambiguous-organization-build-lock/.github/actions/acquire-build-lock@${buildLockSha}` ||
  windowsStep('acquire-build-lock')?.with?.['require-resource-lifecycle'] !== 'true' ||
  windowsStep('acquire-build-lock')?.with?.['minimum-release-cooldown-seconds'] !== '360'
)
  failures.push('RC014: Windows canary must atomically require the lifecycle-aware lock contract');
const windowsRelease = windowsSteps.find((step) => step.name === 'Release organization Unity lock');
const windowsVerify = windowsSteps.find(
  (step) => step.name === 'Verify activation-owning cleanup proof',
);
const cleanupProof = windowsStep('cleanup-proof');
const expectedReleaseCondition =
  "${{ always() && (steps.acquire-build-lock.outcome == 'success' || steps.acquire-build-lock.outcome == 'failure' || steps.acquire-build-lock.outcome == 'cancelled') }}";
if (
  cleanupProof?.if !== "${{ always() && steps.acquire-build-lock.outcome == 'success' }}" ||
  cleanupProof?.run !== './scripts/classify-build-resource-proof.ps1' ||
  [1, 2, 3].some(
    (attempt) =>
      cleanupProof?.env?.[`BUILD_${attempt}_OUTCOME`] !==
        `\${{ steps.build-${attempt}.outcome }}` ||
      cleanupProof?.env?.[`BUILD_${attempt}_RESOURCE_SAFE`] !==
        `\${{ steps.build-${attempt}.outputs.resourceSafe }}`,
  )
)
  failures.push('RC014: cleanup classifier must inspect every attempted build under always()');
if (
  windowsVerify?.if !== '${{ always() }}' ||
  windowsVerify?.env?.LOCK_ACQUIRED !== '${{ steps.acquire-build-lock.outputs.acquired }}' ||
  !windowsVerify?.run?.includes("if ($env:LOCK_ACQUIRED -ne 'true')")
)
  failures.push(
    'RC014: Windows canary must fail after release when lock ownership was not acquired',
  );
const expectedRunnerId =
  '${{ runner.name }}:${{ github.run_id }}:${{ github.run_attempt }}:${{ strategy.job-index }}';
const expectedHolderSuffix = '${{ github.job }}-${{ strategy.job-index }}';
if (
  [windowsStep('acquire-build-lock'), windowsRelease].some(
    (step) =>
      step?.with?.['runner-id'] !== expectedRunnerId ||
      step?.with?.['holder-id-suffix'] !== expectedHolderSuffix,
  )
)
  failures.push('RC014: Windows acquire and release must use the same unique ephemeral identity');
if (
  windowsRelease?.uses !==
    `Ambiguous-Interactive/ambiguous-organization-build-lock/.github/actions/release-build-lock@${buildLockSha}` ||
  windowsRelease?.if !== expectedReleaseCondition ||
  windowsRelease?.with?.['resource-cleanup-status'] !==
    "${{ steps.cleanup-proof.outputs['resource-safe'] == 'true' && 'confirmed' || 'unknown' }}" ||
  windowsRelease?.with?.['resource-health'] !== 'healthy' ||
  windowsRelease?.with?.['resource-reason'] !==
    "${{ steps.cleanup-proof.outputs['resource-safe'] == 'true' && 'cleanup-confirmed' || 'return-missing-positive-evidence' }}" ||
  Object.hasOwn(windowsRelease?.with || {}, 'resource-safe')
)
  failures.push('RC014: Windows release must report typed schema-5 cleanup evidence');

const windowsAggregate = windowsWorkflow.jobs?.['windows-license-ci'];
if (
  windowsAggregate?.if !== '${{ always() }}' ||
  JSON.stringify(windowsAggregate?.needs) !==
    JSON.stringify([
      'resource-cleanup-proof-contract',
      'runner-preflight',
      'buildForAllPlatformsWindows',
    ]) ||
  windowsAggregate?.steps?.[0]?.env?.PREFLIGHT_RESULT !== '${{ needs.runner-preflight.result }}' ||
  windowsAggregate?.steps?.[0]?.env?.UNITY_RESULT !==
    '${{ needs.buildForAllPlatformsWindows.result }}' ||
  !windowsAggregate?.steps?.[0]?.run?.includes('PREFLIGHT_RESULT') ||
  !windowsAggregate?.steps?.[0]?.run?.includes('UNITY_RESULT')
)
  failures.push('RC014: Windows canary aggregate must reject unavailable or skipped licensed work');

for (const [platform, file, jobName] of [
  ['macOS', '.github/workflows/build-tests-mac.yml', 'buildForAllPlatformsMacOS'],
  ['Ubuntu', '.github/workflows/build-tests-ubuntu.yml', 'buildForAllPlatformsUbuntu'],
]) {
  const workflow = parse(read(file));
  if (Object.keys(workflow.on || {}).join(',') !== 'workflow_dispatch')
    failures.push(`RC014: ${platform} build workflow must not run automatically in the fork`);
  if (
    platform === 'macOS' &&
    workflow.jobs?.[jobName]?.if !== "${{ github.repository == 'game-ci/unity-builder' }}"
  )
    failures.push('RC014: paid-license macOS builds must stay disabled in the fork');
  if (platform === 'Ubuntu' && JSON.stringify(workflow).includes('UNITY_SERIAL'))
    failures.push('RC014: Ubuntu Personal-license workflow must not join the paid serial pool');
  if (platform === 'Ubuntu' && JSON.stringify(workflow).includes('secrets.UNITY_'))
    failures.push(
      'RC014: Ubuntu Personal-license workflow must not receive organization Unity secrets',
    );
}

const orchestratorWorkflow = read('.github/workflows/validate-orchestrator-integration.yml');
if (orchestratorWorkflow.includes('secrets.UNITY_'))
  failures.push('RC015: orchestrator integration tests must use synthetic Unity credentials');
if (existsSync(path.join(root, '.github/workflows/sync-secrets.yml')))
  failures.push('RC016: cross-repository secret synchronization must remain removed');

const integrityWorkflow = parse(read('.github/workflows/integrity-check.yml'));
const integrityTests = integrityWorkflow.jobs?.tests;
const coverageArtifactStep = integrityTests?.steps?.find(
  (step) => step.name === 'Preserve coverage for isolated upload',
);
const trustedCoverageJob = integrityWorkflow.jobs?.['upload-trusted-coverage'];
const tokenlessPrCoverageJob = integrityWorkflow.jobs?.['upload-tokenless-pr-coverage'];
const trustedCoverageCondition =
  "(github.event_name == 'push' && github.ref == 'refs/heads/main') || (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.user.login != 'dependabot[bot]')";
const tokenlessPrCoverageCondition =
  "github.event_name == 'pull_request' && (github.event.pull_request.head.repo.full_name != github.repository || github.event.pull_request.user.login == 'dependabot[bot]')";
const expectedTrustedSteps = [
  {
    name: 'Download coverage',
    uses: 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
    with: { name: 'coverage-report', path: 'coverage' },
  },
  {
    name: 'Upload coverage to Codecov with OIDC',
    uses: 'codecov/codecov-action@fb8b3582c8e4def4969c97caa2f19720cb33a72f',
    with: {
      disable_search: true,
      fail_ci_if_error: true,
      files: './coverage/lcov.info',
      use_oidc: true,
    },
  },
];
const expectedPrSteps = [
  expectedTrustedSteps[0],
  {
    name: 'Upload unprotected fork or Dependabot coverage without a token',
    uses: 'codecov/codecov-action@fb8b3582c8e4def4969c97caa2f19720cb33a72f',
    with: {
      disable_search: true,
      fail_ci_if_error: true,
      files: './coverage/lcov.info',
      override_branch:
        'pr${{ github.event.pull_request.number }}:${{ github.event.pull_request.head.ref }}',
      use_oidc: false,
    },
  },
];
const uploadJobUsesCheckout = (job) =>
  (job?.steps || []).some((step) => String(step.uses || '').startsWith('actions/checkout@'));
if (
  integrityTests?.permissions?.contents !== 'read' ||
  Object.keys(integrityTests?.permissions || {}).length !== 1 ||
  Object.hasOwn(integrityTests?.permissions || {}, 'id-token') ||
  (integrityTests?.steps || []).some((step) => String(step.uses || '').startsWith('codecov/')) ||
  coverageArtifactStep?.uses !==
    'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a' ||
  coverageArtifactStep?.with?.name !== 'coverage-report' ||
  coverageArtifactStep?.with?.path !== './coverage/lcov.info' ||
  coverageArtifactStep?.with?.['if-no-files-found'] !== 'error' ||
  coverageArtifactStep?.with?.['retention-days'] !== 1 ||
  trustedCoverageJob?.if !== trustedCoverageCondition ||
  trustedCoverageJob?.needs !== 'tests' ||
  trustedCoverageJob?.permissions?.['id-token'] !== 'write' ||
  Object.keys(trustedCoverageJob?.permissions || {}).length !== 1 ||
  uploadJobUsesCheckout(trustedCoverageJob) ||
  JSON.stringify(trustedCoverageJob?.steps) !== JSON.stringify(expectedTrustedSteps) ||
  tokenlessPrCoverageJob?.if !== tokenlessPrCoverageCondition ||
  tokenlessPrCoverageJob?.needs !== 'tests' ||
  tokenlessPrCoverageJob?.permissions?.contents !== 'read' ||
  Object.keys(tokenlessPrCoverageJob?.permissions || {}).length !== 1 ||
  Object.hasOwn(tokenlessPrCoverageJob?.permissions || {}, 'id-token') ||
  uploadJobUsesCheckout(tokenlessPrCoverageJob) ||
  JSON.stringify(tokenlessPrCoverageJob?.steps) !== JSON.stringify(expectedPrSteps) ||
  JSON.stringify(integrityWorkflow).includes('secrets.CODECOV')
)
  failures.push(
    'RC019: coverage must cross an artifact boundary into exact isolated pinned OIDC and fork/Dependabot tokenless upload jobs',
  );

const pendingWorkflowDirectories = [path.join(root, '.github')];
while (pendingWorkflowDirectories.length > 0) {
  const directory = pendingWorkflowDirectories.pop();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      pendingWorkflowDirectories.push(absolute);
      continue;
    }
    if (!entry.isFile() || (!entry.name.endsWith('.yml') && !entry.name.endsWith('.yaml')))
      continue;
    const fileName = path.relative(path.join(root, '.github'), absolute).replaceAll('\\', '/');
    const workflow = parse(read(path.relative(root, absolute)));
    for (const finding of findCredentialShapedEnvLiterals(workflow, fileName)) {
      failures.push(`RC018: ${renderCredentialFinding(finding)}`);
    }
  }
}

for (const fileName of readdirSync(path.join(root, '.github/workflows'))) {
  if (!fileName.endsWith('.yml') && !fileName.endsWith('.yaml')) continue;
  const workflow = parse(read(`.github/workflows/${fileName}`));
  const pending = [workflow];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    if (
      typeof value.uses === 'string' &&
      !value.uses.startsWith('./') &&
      !/@[0-9a-f]{40}$/.test(value.uses)
    )
      failures.push(`RC017: ${fileName} has mutable action reference ${value.uses}`);
    pending.push(...Object.values(value));
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Resource cleanup contract verified (RC001-RC019).');
