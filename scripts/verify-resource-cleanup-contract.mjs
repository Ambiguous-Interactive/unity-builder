import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import {
  findCredentialShapedEnvLiterals,
  renderCredentialFinding,
} from './workflow-credential-policy.mjs';

const root = path.resolve(process.argv[2] || '.');
const failures = [];

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
requireText('RC014', 'scripts/classify-build-resource-proof.ps1', "'cleanup-confirmed'");
requireText('RC014', 'scripts/classify-build-resource-proof.ps1', "'cleanup-evidence-unknown'");
requireText(
  'RC014',
  'scripts/classify-build-resource-proof.ps1',
  "'return-missing-positive-evidence'",
);
const cleanupClassifier = read('scripts/classify-build-resource-proof.ps1');
if (
  cleanupClassifier.includes('no-activation-current-head-rejected') ||
  cleanupClassifier.includes('no-activation-proof')
)
  failures.push('RC014: cleanup classifier must emit only pinned build-lock reason codes');
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
const actionManifest = parse(read('action.yml'));
for (const output of [
  'resourceSafe',
  'resourceCleanupStatus',
  'resourceHealth',
  'resourceReason',
  'resourceEvidenceDigest',
]) {
  if (!Object.hasOwn(actionManifest.outputs || {}, output))
    failures.push(`RC020: action.yml is missing typed lifecycle output ${output}`);
}
requireText('RC020', 'src/index.ts', "process.platform === 'darwin'");
requireText(
  'RC020',
  'dist/platforms/mac/steps/activate.sh',
  'UNITY_BUILDER_RESOURCE_ACTIVATION_LOG_PATH',
);
requireText(
  'RC020',
  'dist/platforms/mac/steps/return_license.sh',
  'UNITY_BUILDER_RESOURCE_RETURN_LOG_PATH',
);
requireText('RC020', 'dist/platforms/mac/steps/return_license.sh', 'RETURN_TIMEOUT_SECONDS');
requireText('RC020', 'dist/platforms/mac/steps/return_license.sh', 'RETURN_KILL_GRACE_SECONDS');
requireText('RC020', 'dist/platforms/mac/steps/return_license.sh', 'signal_return_tree KILL');
requireText('RC020', 'dist/platforms/mac/steps/return_license.sh', 'completed:${return_exit_code}');
requireOrder('RC020', 'dist/platforms/mac/entrypoint.sh', [
  'trap cleanup_license EXIT',
  'activation_attempted=true',
  'source "$ACTION_FOLDER/platforms/mac/steps/activate.sh"',
  'source "$ACTION_FOLDER/platforms/mac/steps/build.sh"',
  'exit "$BUILD_EXIT_CODE"',
]);
requireText(
  'RC020',
  'dist/platforms/mac/steps/return_license.sh',
  'Successfully returned the entitlement license',
);
requireText(
  'RC020',
  'dist/platforms/mac/steps/return_license.sh',
  'Successfully returned ULF license with serial number',
);
if (
  read('dist/platforms/mac/steps/activate.sh').includes('-logFile -') ||
  read('dist/platforms/mac/steps/return_license.sh').includes('-logFile -')
)
  failures.push('RC020: macOS activation and return evidence must remain private');
if (
  !read('dist/platforms/mac/steps/return_license.sh').includes(
    '"$return_exit_code" == 0 && "$entitlement_returned" == true && "$ulf_returned" == true',
  ) ||
  !read('src/model/resource-cleanup-proof.ts').includes("returnStatus === 'completed:0'") ||
  !read('src/model/resource-cleanup-proof.ts').includes('attempt.requiresNativeReturnEvidence')
)
  failures.push(
    'RC020: native macOS proof must require a present exact log and completed zero exit status',
  );
const macReturnRuntime = read('dist/platforms/mac/steps/return_license.sh');
const macIsolationLauncher = read('dist/platforms/mac/steps/launch_isolated.py');
if (
  !macReturnRuntime.includes('snapshot_return_descendants') ||
  !macReturnRuntime.includes('return_tree_alive') ||
  !macReturnRuntime.includes('RETURN_ISOLATION_READY') ||
  !macReturnRuntime.includes('RETURN_ISOLATION_ACK') ||
  !macReturnRuntime.includes('"$observed_pgid" == "$return_pid"') ||
  !macReturnRuntime.includes('kill_unisolated_return_bounded') ||
  !macReturnRuntime.includes('kill -"$signal" -- "-$return_pgid"') ||
  !macReturnRuntime.includes('signal_return_tree TERM') ||
  !macReturnRuntime.includes('signal_return_tree KILL') ||
  !macReturnRuntime.includes('if ! return_tree_alive; then') ||
  !macIsolationLauncher.includes('os.setsid()') ||
  !macIsolationLauncher.includes('os.getpgrp()') ||
  !macIsolationLauncher.includes('os.replace(') ||
  !macIsolationLauncher.includes('os.execv(')
)
  failures.push(
    'RC020: bounded macOS termination must track and kill descendants even after the Unity parent exits',
  );
const cleanupProofSource = read('src/model/resource-cleanup-proof.ts');
if (
  cleanupProofSource.includes('.update(returned.bytes)') ||
  cleanupProofSource.includes('.update(activation.bytes)') ||
  !cleanupProofSource.includes('.update(attempt.nonce)')
)
  failures.push(
    'RC020: the public evidence digest must bind normalized classifications, never secret-bearing logs',
  );

for (const [platform, file, runner, command, aggregateName] of [
  [
    'macOS',
    '.github/workflows/build-tests-mac.yml',
    'macos-14',
    'bash scripts/test-macos-resource-proof.sh',
    'macos-cleanup-contract',
  ],
  [
    'Windows',
    '.github/workflows/build-tests-windows.yml',
    'windows-2022',
    './scripts/test-windows-resource-proof.ps1',
    'windows-cleanup-contract',
  ],
]) {
  const workflow = parse(read(file));
  const serialized = JSON.stringify(workflow);
  const platformKey = platform === 'macOS' ? 'macos' : 'windows';
  const expected = {
    name: `Builds - ${platform}`,
    on:
      platform === 'macOS'
        ? { workflow_dispatch: null }
        : {
            pull_request: { branches: ['main'] },
            workflow_dispatch: null,
            push: null,
          },
    concurrency: {
      group:
        platform === 'macOS'
          ? '${{ github.workflow }}-${{ github.ref }}'
          : '${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}',
      'cancel-in-progress': false,
    },
    permissions: { contents: 'read' },
    jobs: {
      'resource-cleanup-proof-contract': {
        name: `${platform} resource cleanup proof contract`,
        'runs-on': runner,
        steps: [
          {
            uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
          },
          {
            name: 'Exercise private return evidence fixtures',
            ...(platform === 'Windows' ? { shell: 'pwsh' } : {}),
            run: command,
          },
        ],
      },
      [aggregateName]: {
        name: `${platform} cleanup contract`,
        if: '${{ always() }}',
        needs: ['resource-cleanup-proof-contract'],
        'runs-on': 'ubuntu-latest',
        steps: [
          {
            name: 'Require cleanup fixture coverage',
            ...(platform === 'Windows' ? { shell: 'bash' } : {}),
            env: {
              CONTRACT_RESULT: '${{ needs.resource-cleanup-proof-contract.result }}',
            },
            run:
              'set -euo pipefail\n' +
              'if [[ "${CONTRACT_RESULT}" != success ]]; then\n' +
              `  echo "::error::${platform} cleanup fixtures finished with \${CONTRACT_RESULT}."\n` +
              '  exit 1\n' +
              'fi\n' +
              `echo 'The fork runs cleanup fixtures without organization Unity credentials.'\n`,
          },
        ],
      },
    },
  };
  if (JSON.stringify(workflow) !== JSON.stringify(expected))
    failures.push(
      `RC020: ${platformKey} fork workflow must match the exact two-step fixture and one-step aggregate contract`,
    );
  if (
    serialized.includes('secrets.UNITY_') ||
    serialized.includes('BUILD_LOCK_') ||
    serialized.includes('ambiguous-organization-build-lock') ||
    serialized.includes('"uses":"./"')
  )
    failures.push(
      `RC020: ${platform} fork workflow must not activate Unity or receive organization lifecycle credentials`,
    );
}

const upstreamSync = read('.github/workflows/upstream-sync.yml');
const verifierCopies =
  upstreamSync.match(/cp .*verify-resource-cleanup-contract\.mjs .*verify\.mjs/g) || [];
const policyCopies =
  upstreamSync.match(/cp .*workflow-credential-policy\.mjs .*workflow-credential-policy\.mjs/g) ||
  [];
if (verifierCopies.length !== 2 || policyCopies.length !== verifierCopies.length)
  failures.push('RC014: every isolated upstream verifier must copy its imported policy module');

for (const [platform, file] of [
  ['macOS', '.github/workflows/build-tests-mac.yml'],
  ['Ubuntu', '.github/workflows/build-tests-ubuntu.yml'],
]) {
  const workflow = parse(read(file));
  if (Object.keys(workflow.on || {}).join(',') !== 'workflow_dispatch')
    failures.push(`RC014: ${platform} build workflow must not run automatically in the fork`);
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
const integrityTestSteps = integrityTests?.steps || [];
const coverageGenerationStepIndex = integrityTestSteps.findIndex(
  (step) => step.run === 'yarn test:ci --coverage',
);
const coverageArtifactStepIndex = integrityTestSteps.findIndex(
  (step) => step.name === 'Preserve coverage for isolated upload',
);
const distVerificationStepIndex = integrityTestSteps.findIndex(
  (step) => step.name === 'Verify generated distribution',
);
const coverageGenerationStep = integrityTestSteps[coverageGenerationStepIndex];
const coverageArtifactStep = integrityTestSteps[coverageArtifactStepIndex];
const hasExplicitConditionOrFailureOverride = (step) =>
  Object.hasOwn(step || {}, 'if') || Object.hasOwn(step || {}, 'continue-on-error');
const trustedCoverageJob = integrityWorkflow.jobs?.['upload-trusted-coverage'];
const tokenlessPrCoverageJob = integrityWorkflow.jobs?.['upload-tokenless-pr-coverage'];
const trustedCoverageCondition =
  "always() && needs.tests.outputs.coverage-artifact-id != '' && ((github.event_name == 'push' && github.ref == 'refs/heads/main') || (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.user.login != 'dependabot[bot]'))";
const tokenlessPrCoverageCondition =
  "always() && needs.tests.outputs.coverage-artifact-id != '' && github.event_name == 'pull_request' && (github.event.pull_request.head.repo.full_name != github.repository || github.event.pull_request.user.login == 'dependabot[bot]')";
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
  integrityTestSteps.some((step) => String(step.uses || '').startsWith('codecov/')) ||
  integrityTests?.outputs?.['coverage-artifact-id'] !==
    '${{ steps.coverage-artifact.outputs.artifact-id }}' ||
  coverageGenerationStepIndex < 0 ||
  coverageArtifactStepIndex <= coverageGenerationStepIndex ||
  distVerificationStepIndex <= coverageArtifactStepIndex ||
  hasExplicitConditionOrFailureOverride(coverageGenerationStep) ||
  hasExplicitConditionOrFailureOverride(coverageArtifactStep) ||
  coverageArtifactStep?.id !== 'coverage-artifact' ||
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
console.log('Resource cleanup contract verified (RC001-RC020).');
