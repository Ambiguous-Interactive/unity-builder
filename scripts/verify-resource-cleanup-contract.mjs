import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import {
  findCredentialShapedEnvLiterals,
  renderCredentialFinding,
} from './workflow-credential-policy.mjs';

const root = path.resolve(process.argv[2] || '.');
const failures = [];
const buildLockSha = '59a2fa98224569e5a697f271a3ac4b866c53ac2c';
const runBashContractTests =
  process.platform !== 'win32' || process.env.RUN_BASH_CONTRACT_TESTS === 'true';

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
  !read('src/model/resource-cleanup-proof.ts').includes(
    "status.bytes.toString('utf8') === 'completed:0'",
  ) ||
  !read('src/model/resource-cleanup-proof.ts').includes('attempt.requiresNativeReturnEvidence')
)
  failures.push(
    'RC020: native macOS proof must require a present exact log and completed zero exit status',
  );
const macReturnRuntime = read('dist/platforms/mac/steps/return_license.sh');
if (
  !macReturnRuntime.includes('snapshot_return_descendants') ||
  !macReturnRuntime.includes('return_tree_alive') ||
  !macReturnRuntime.includes('return_pgid=$return_pid') ||
  !macReturnRuntime.includes('kill -"$signal" -- "-$return_pgid"') ||
  !macReturnRuntime.includes('signal_return_tree TERM') ||
  !macReturnRuntime.includes('signal_return_tree KILL') ||
  !macReturnRuntime.includes('if ! return_tree_alive; then')
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

const windowsWorkflow = parse(read('.github/workflows/build-tests-windows.yml'));
const windowsMatrix = windowsWorkflow.jobs?.['matrix-config'];
const windowsCurrentHead = windowsWorkflow.jobs?.['current-pr-head'];
const windowsPreflight = windowsWorkflow.jobs?.['runner-preflight'];
const windowsJob = windowsWorkflow.jobs?.buildForAllPlatformsWindows;
const windowsSteps = windowsJob?.steps || [];
const windowsStepIndex = (id) => windowsSteps.findIndex((step) => step.id === id);
const windowsStep = (id) => windowsSteps.find((step) => step.id === id);
if (
  JSON.stringify(windowsWorkflow.permissions) !==
  JSON.stringify({ contents: 'read', 'pull-requests': 'read' })
)
  failures.push('RC014: Windows canary must grant only read access to contents and PR state');
if (
  !Object.hasOwn(windowsWorkflow.on || {}, 'push') ||
  !Object.hasOwn(windowsWorkflow.on || {}, 'pull_request') ||
  !Object.hasOwn(windowsWorkflow.on || {}, 'workflow_dispatch')
)
  failures.push('RC014: Windows workflow must retain push checks, trusted PR smoke, and dispatch');
const dispatchMode = windowsWorkflow.on?.workflow_dispatch?.inputs?.mode;
if (
  dispatchMode?.type !== 'choice' ||
  dispatchMode?.default !== 'preflight-only' ||
  JSON.stringify(dispatchMode?.options) !== JSON.stringify(['preflight-only', 'smoke', 'full'])
)
  failures.push('RC014: dispatch must default safely and require an explicit licensed mode');
const trustedPr =
  "github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.user.login != 'dependabot[bot]'";
const expectedPreflightCondition = `github.event_name == 'workflow_dispatch' || (${trustedPr})`;
const expectedLicensedCondition = `(github.event_name == 'workflow_dispatch' && inputs.mode != 'preflight-only') || (${trustedPr})`;
if (windowsWorkflow.concurrency?.['cancel-in-progress'] !== false)
  failures.push('RC014: automatic supersession must never cancel a licensed Windows holder');
if (windowsJob?.if !== expectedLicensedCondition)
  failures.push('RC014: licensed Windows work must be a bounded trusted PR or explicit dispatch');
const hostedHeadStep = windowsCurrentHead?.steps?.[0];
if (
  windowsCurrentHead?.['runs-on'] !== 'ubuntu-latest' ||
  hostedHeadStep?.if !== trustedPr ||
  hostedHeadStep?.uses !== 'actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b' ||
  !hostedHeadStep?.with?.script?.includes("current.state !== 'open'") ||
  !hostedHeadStep?.with?.script?.includes("current.base.ref !== 'main'") ||
  !hostedHeadStep?.with?.script?.includes('current.head.sha !== expected.head.sha')
)
  failures.push('RC014: a hosted prerequisite must reject stale or ineligible licensed PRs');
if (
  windowsMatrix?.outputs?.matrix !== '${{ steps.select.outputs.matrix }}' ||
  windowsMatrix?.steps?.[0]?.id !== 'select' ||
  !windowsMatrix?.steps?.[0]?.run?.includes('2022.3.62f3') ||
  !windowsMatrix?.steps?.[0]?.run?.includes('StandaloneWindows64') ||
  !windowsMatrix?.steps?.[0]?.run?.includes('MODE')
)
  failures.push(
    'RC014: matrix selection must encode one bounded smoke and the explicit full matrix',
  );
const matrixScript = windowsMatrix?.steps?.[0]?.run || '';
const matrixAssignment = (name) => {
  const match = matrixScript.match(new RegExp(`^${name}='([^']+)'$`, 'm'));
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
};
const smokeMatrix = matrixAssignment('smoke');
const fullMatrix = matrixAssignment('full');
const requiredMatrixKeys = ['projectPath', 'unityVersion', 'targetPlatform', 'enableGpu'];
const matrixCardinality = (matrix) => {
  if (!matrix) return 0;
  const baseKeys = requiredMatrixKeys.filter((key) => Array.isArray(matrix[key]));
  const baseCount = baseKeys.length
    ? baseKeys.reduce((count, key) => count * matrix[key].length, 1)
    : 0;
  return baseCount + (matrix.include?.length || 0);
};
const fullBaseCount = fullMatrix
  ? requiredMatrixKeys.reduce(
      (count, key) => count * (Array.isArray(fullMatrix[key]) ? fullMatrix[key].length : 0),
      1,
    )
  : 0;
const includesCannotMergeIntoBase = fullMatrix?.include?.every((entry) =>
  requiredMatrixKeys.some(
    (key) => Array.isArray(fullMatrix[key]) && !fullMatrix[key].includes(entry[key]),
  ),
);
if (
  smokeMatrix?.include?.length !== 1 ||
  requiredMatrixKeys.some((key) => !Object.hasOwn(smokeMatrix.include[0] || {}, key)) ||
  fullBaseCount + (fullMatrix?.include?.length || 0) !== 15 ||
  !includesCannotMergeIntoBase ||
  fullMatrix?.include?.some((entry) =>
    requiredMatrixKeys.some((key) => !Object.hasOwn(entry || {}, key)),
  )
)
  failures.push(
    'RC014: smoke must be one complete leg and full dispatch must preserve 15 complete legs',
  );
if (runBashContractTests && matrixScript) {
  const selectorCases = [
    ['pull request', 'pull_request', '', 0, 1],
    ['push', 'push', '', 0, 1],
    ['dispatch preflight', 'workflow_dispatch', 'preflight-only', 0, 1],
    ['dispatch smoke', 'workflow_dispatch', 'smoke', 0, 1],
    ['dispatch full', 'workflow_dispatch', 'full', 0, 15],
    ['unsupported mode', 'workflow_dispatch', 'malformed', 1, 0],
    ['unsupported event', 'schedule', '', 1, 0],
  ];
  for (const [name, eventName, mode, expectedStatus, expectedCount] of selectorCases) {
    const outputDirectory = mkdtempSync(path.join(tmpdir(), 'unity-windows-matrix-'));
    const outputPath = path.join(outputDirectory, 'output');
    try {
      const result = spawnSync('bash', ['-c', matrixScript], {
        env: {
          ...process.env,
          EVENT_NAME: eventName,
          MODE: mode,
          GITHUB_OUTPUT: outputPath,
        },
        encoding: 'utf8',
      });
      let actualCount = 0;
      if (existsSync(outputPath)) {
        const match = readFileSync(outputPath, 'utf8').match(/^matrix=(.+)$/m);
        if (match) {
          try {
            actualCount = matrixCardinality(JSON.parse(match[1]));
          } catch {
            actualCount = -1;
          }
        }
      }
      if (result.status !== expectedStatus || actualCount !== expectedCount)
        failures.push(
          `RC014: selector case ${name} expected status/count ${expectedStatus}/${expectedCount}, got ${result.status}/${actualCount}: ${result.stdout}${result.stderr}`,
        );
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  }
}
if (
  windowsPreflight?.if !== expectedPreflightCondition ||
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
  JSON.stringify(windowsJob?.needs) !==
    JSON.stringify([
      'resource-cleanup-proof-contract',
      'matrix-config',
      'current-pr-head',
      'runner-preflight',
    ]) ||
  windowsJob?.strategy?.matrix !== '${{ fromJSON(needs.matrix-config.outputs.matrix) }}' ||
  JSON.stringify(windowsJob?.['runs-on']) !== JSON.stringify(['self-hosted', 'Windows', 'RAM-64GB'])
)
  failures.push('RC014: licensed Windows matrix must run only on the preflighted fleet');
if (windowsJob?.strategy?.['max-parallel'] !== 1)
  failures.push('RC014: licensed Windows matrix must admit only one runner at a time');
const currentHeadSteps = [
  ['current-pr-head-before-acquire', "${{ github.event_name == 'pull_request' }}"],
  [
    'current-pr-head-after-acquire',
    "${{ steps.acquire-build-lock.outputs.acquired == 'true' && github.event_name == 'pull_request' }}",
  ],
];
const acquireIndex = windowsStepIndex('acquire-build-lock');
if (
  currentHeadSteps.some(([id, expectedCondition]) => {
    const step = windowsStep(id);
    return (
      step?.if !== expectedCondition ||
      step?.env?.GH_TOKEN !== '${{ github.token }}' ||
      step?.env?.EXPECTED_BASE_REF !== 'main' ||
      step?.env?.EXPECTED_HEAD_REPOSITORY !== '${{ github.repository }}' ||
      step?.run !== './scripts/assert-current-pr-head.ps1'
    );
  }) ||
  windowsStepIndex('current-pr-head-before-acquire') !== acquireIndex - 1 ||
  !read('scripts/assert-current-pr-head.ps1').includes("$pullRequest.state -eq 'open'") ||
  !read('scripts/assert-current-pr-head.ps1').includes(
    '$pullRequest.head.sha -eq $env:EXPECTED_HEAD_SHA',
  ) ||
  !read('scripts/assert-current-pr-head.ps1').includes('-TimeoutSec 30')
)
  failures.push('RC014: stale PR revisions must stop before licensed runner setup or acquisition');
const expectedBuildConditions = [
  "${{ steps.acquire-build-lock.outputs.acquired == 'true' }}",
  "${{ steps.acquire-build-lock.outputs.acquired == 'true' && steps.build-1.outcome == 'failure' && steps.build-1.outputs.resourceSafe == 'true' }}",
  "${{ steps.acquire-build-lock.outputs.acquired == 'true' && steps.build-1.outcome == 'failure' && steps.build-1.outputs.resourceSafe == 'true' && steps.build-2.outcome == 'failure' && steps.build-2.outputs.resourceSafe == 'true' }}",
];
if (
  [1, 2, 3].some(
    (attempt) =>
      windowsStep(`build-${attempt}`)?.if !== expectedBuildConditions[attempt - 1] ||
      windowsStep(`build-${attempt}`)?.with?.buildProfile !== '${{ matrix.buildProfile }}',
  )
)
  failures.push(
    'RC014: every licensed Windows attempt must require lock ownership and preserve matrix inputs',
  );
const retrySleeps = windowsSteps.filter((step) => step.name === 'Sleep for Retry');
if (
  retrySleeps.length !== 2 ||
  retrySleeps[0]?.if !== expectedBuildConditions[1] ||
  retrySleeps[1]?.if !== expectedBuildConditions[2]
)
  failures.push('RC014: outer retries must stop without positive cleanup proof');
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
  windowsStep('acquire-build-lock')?.with?.['minimum-release-cooldown-seconds'] !== '1'
)
  failures.push('RC014: Windows canary must atomically require the lifecycle-aware lock contract');
const windowsRelease = windowsSteps.find((step) => step.name === 'Release organization Unity lock');
const windowsVerify = windowsSteps.find(
  (step) => step.name === 'Verify activation-owning cleanup proof',
);
const cleanupProof = windowsStep('cleanup-proof');
const postAcquireHead = windowsStep('current-pr-head-after-acquire');
const expectedReleaseCondition =
  "${{ always() && (steps.acquire-build-lock.outcome == 'success' || steps.acquire-build-lock.outcome == 'failure' || steps.acquire-build-lock.outcome == 'cancelled') }}";
if (
  postAcquireHead?.if !==
    "${{ steps.acquire-build-lock.outputs.acquired == 'true' && github.event_name == 'pull_request' }}" ||
  postAcquireHead?.run !== './scripts/assert-current-pr-head.ps1' ||
  windowsStepIndex('current-pr-head-after-acquire') !==
    windowsStepIndex('acquire-build-lock') + 1 ||
  windowsStepIndex('build-1') !== windowsStepIndex('current-pr-head-after-acquire') + 1
)
  failures.push('RC014: FIFO admission must revalidate the exact PR head before activation');
if (
  cleanupProof?.if !== expectedReleaseCondition ||
  cleanupProof?.run !== './scripts/classify-build-resource-proof.ps1' ||
  cleanupProof?.env?.POST_ACQUIRE_HEAD_OUTCOME !==
    '${{ steps.current-pr-head-after-acquire.outcome }}' ||
  cleanupProof?.env?.QUARANTINE_RECOVERED !==
    "${{ steps.acquire-build-lock.outputs['quarantine-recovered'] }}" ||
  [1, 2, 3].some(
    (attempt) =>
      cleanupProof?.env?.[`BUILD_${attempt}_OUTCOME`] !==
        `\${{ steps.build-${attempt}.outcome }}` ||
      cleanupProof?.env?.[`BUILD_${attempt}_RESOURCE_SAFE`] !==
        `\${{ steps.build-${attempt}.outputs.resourceSafe }}`,
  )
)
  failures.push(
    'RC014: cleanup classifier must run for every release-eligible acquire outcome and inspect every attempted build',
  );
if (
  windowsVerify?.if !== '${{ always() }}' ||
  windowsVerify?.env?.LOCK_ACQUIRED !== '${{ steps.acquire-build-lock.outputs.acquired }}' ||
  windowsVerify?.env?.CLEANUP_RESOURCE_SAFE !==
    "${{ steps.cleanup-proof.outputs['resource-safe'] }}" ||
  windowsVerify?.env?.CLEANUP_RESOURCE_REASON !==
    "${{ steps.cleanup-proof.outputs['resource-reason'] }}" ||
  !windowsVerify?.run?.includes("if ($env:LOCK_ACQUIRED -ne 'true')")
)
  failures.push(
    'RC014: Windows canary must fail after release when lock ownership was not acquired',
  );
if (
  !windowsVerify?.run?.includes("$env:CLEANUP_RESOURCE_SAFE -ne 'true' -or") ||
  !windowsVerify?.run?.includes("$env:CLEANUP_RESOURCE_REASON -ne 'cleanup-confirmed'")
)
  failures.push('RC014: Windows canary must require the exact confirmed cleanup proof tuple');
const expectedRunnerId = '${{ runner.name }}';
const expectedHolderSuffix = '${{ github.job }}-${{ strategy.job-index }}';
if (
  [windowsStep('acquire-build-lock'), windowsRelease].some(
    (step) =>
      step?.with?.['runner-id'] !== expectedRunnerId ||
      step?.with?.['holder-id-suffix'] !== expectedHolderSuffix,
  )
)
  failures.push(
    'RC014: Windows acquire and release must use the same stable physical runner and unique holder identity',
  );
if (
  windowsRelease?.uses !==
    `Ambiguous-Interactive/ambiguous-organization-build-lock/.github/actions/release-build-lock@${buildLockSha}` ||
  windowsRelease?.if !== expectedReleaseCondition ||
  windowsRelease?.with?.['resource-cleanup-status'] !==
    "${{ (steps.cleanup-proof.outputs['resource-safe'] == 'true' && steps.cleanup-proof.outputs['resource-reason'] == 'cleanup-confirmed' && 'confirmed') || 'unknown' }}" ||
  windowsRelease?.with?.['resource-health'] !== 'healthy' ||
  windowsRelease?.with?.['resource-reason'] !==
    "${{ (steps.cleanup-proof.outputs['resource-safe'] == 'true' && steps.cleanup-proof.outputs['resource-reason'] == 'cleanup-confirmed' && 'cleanup-confirmed') || (steps.cleanup-proof.outputs['resource-reason'] == 'return-missing-positive-evidence' && 'return-missing-positive-evidence') || 'cleanup-evidence-unknown' }}" ||
  Object.hasOwn(windowsRelease?.with || {}, 'resource-safe')
)
  failures.push('RC014: Windows release must report typed schema-5 cleanup evidence');

const windowsAggregate = windowsWorkflow.jobs?.['windows-license-ci'];
const aggregateStep = windowsAggregate?.steps?.[0];
if (
  windowsAggregate?.if !== '${{ always() }}' ||
  JSON.stringify(windowsAggregate?.needs) !==
    JSON.stringify([
      'resource-cleanup-proof-contract',
      'matrix-config',
      'current-pr-head',
      'runner-preflight',
      'buildForAllPlatformsWindows',
    ]) ||
  aggregateStep?.env?.MATRIX_RESULT !== '${{ needs.matrix-config.result }}' ||
  aggregateStep?.env?.HEAD_RESULT !== '${{ needs.current-pr-head.result }}' ||
  aggregateStep?.env?.PREFLIGHT_RESULT !== '${{ needs.runner-preflight.result }}' ||
  aggregateStep?.env?.UNITY_RESULT !== '${{ needs.buildForAllPlatformsWindows.result }}' ||
  aggregateStep?.env?.PREFLIGHT_REQUIRED !==
    "${{ github.event_name == 'workflow_dispatch' || (" + trustedPr + ') }}' ||
  aggregateStep?.env?.LICENSED_REQUIRED !==
    "${{ (github.event_name == 'workflow_dispatch' && inputs.mode != 'preflight-only') || (" +
      trustedPr +
      ') }}' ||
  !aggregateStep?.run?.includes('PREFLIGHT_REQUIRED') ||
  !aggregateStep?.run?.includes('LICENSED_REQUIRED') ||
  !aggregateStep?.run?.includes('HEAD_RESULT')
)
  failures.push('RC014: Windows canary aggregate must reject unavailable or skipped licensed work');

if (runBashContractTests && aggregateStep?.run) {
  const aggregateCases = [
    ['trusted PR success', 'true', 'true', 'success', 'success', 'success', 0],
    ['preflight-only success', 'true', 'false', 'success', 'success', 'skipped', 0],
    ['fork, Dependabot, or push', 'false', 'false', 'success', 'skipped', 'skipped', 0],
    ['head validation failed', 'true', 'true', 'failure', 'success', 'success', 1],
    ['runner unavailable', 'true', 'true', 'success', 'failure', 'skipped', 1],
    ['licensed work skipped', 'true', 'true', 'success', 'success', 'skipped', 1],
    ['licensed work failed', 'true', 'true', 'success', 'success', 'failure', 1],
    ['licensed work cancelled', 'true', 'true', 'success', 'success', 'cancelled', 1],
    ['unexpected unlicensed work', 'false', 'false', 'success', 'skipped', 'success', 1],
  ];
  for (const [
    name,
    preflightRequired,
    licensedRequired,
    head,
    preflight,
    unity,
    expected,
  ] of aggregateCases) {
    const outputDirectory = mkdtempSync(path.join(tmpdir(), 'unity-windows-aggregate-'));
    const summaryPath = path.join(outputDirectory, 'summary');
    try {
      const result = spawnSync('bash', ['-c', aggregateStep.run], {
        env: {
          ...process.env,
          PROOF_RESULT: 'success',
          MATRIX_RESULT: 'success',
          HEAD_RESULT: head,
          PREFLIGHT_REQUIRED: preflightRequired,
          LICENSED_REQUIRED: licensedRequired,
          PREFLIGHT_RESULT: preflight,
          UNITY_RESULT: unity,
          GITHUB_STEP_SUMMARY: summaryPath,
        },
        encoding: 'utf8',
      });
      const summary = existsSync(summaryPath) ? readFileSync(summaryPath, 'utf8') : '';
      if (
        result.status !== expected ||
        (name === 'fork, Dependabot, or push' &&
          (!result.stdout.includes('Unlicensed by policy') ||
            !summary.includes('Unlicensed by policy')))
      )
        failures.push(
          `RC014: aggregate case ${name} expected ${expected}, got ${result.status}: ${result.stdout}${result.stderr}${summary}`,
        );
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  }
}

const macWorkflow = parse(read('.github/workflows/build-tests-mac.yml'));
const macContract = macWorkflow.jobs?.['resource-cleanup-proof-contract'];
const macCanary = macWorkflow.jobs?.boundedOrganizationMacOSCanary;
const macUpstream = macWorkflow.jobs?.buildForAllPlatformsMacOS;
const macAggregate = macWorkflow.jobs?.['macos-license-ci'];
const macSteps = macCanary?.steps || [];
const macStepIndex = (id) => macSteps.findIndex((step) => step.id === id);
const macStep = (id) => macSteps.find((step) => step.id === id);
const macMode = macWorkflow.on?.workflow_dispatch?.inputs?.mode;
const expectedMacCondition =
  "github.repository == 'Ambiguous-Interactive/unity-builder' && inputs.mode == 'smoke'";
if (
  Object.keys(macWorkflow.on || {}).join(',') !== 'workflow_dispatch' ||
  JSON.stringify(macWorkflow.permissions) !== JSON.stringify({ contents: 'read' }) ||
  macWorkflow.concurrency?.['cancel-in-progress'] !== false
)
  failures.push(
    'RC020: macOS canary must remain manual, read-only, and immune to automatic cancellation',
  );
if (
  macMode?.type !== 'choice' ||
  macMode?.default !== 'contract-only' ||
  JSON.stringify(macMode?.options) !== JSON.stringify(['contract-only', 'smoke', 'upstream-full'])
)
  failures.push(
    'RC020: macOS dispatch must distinguish the unlicensed contract, bounded smoke, and upstream matrix',
  );
if (
  macContract?.['runs-on'] !== 'macos-14' ||
  macContract?.steps?.[0]?.uses !== 'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5' ||
  macContract?.steps?.[1]?.run !== 'bash scripts/test-macos-resource-proof.sh'
)
  failures.push('RC020: macOS canary must run its platform cleanup fixtures first');
if (
  macUpstream?.if !==
    "${{ github.repository == 'game-ci/unity-builder' && inputs.mode == 'upstream-full' }}" ||
  macCanary?.if !== expectedMacCondition ||
  macCanary?.['runs-on'] !== 'macos-14' ||
  JSON.stringify(macCanary?.needs) !== JSON.stringify(['resource-cleanup-proof-contract']) ||
  macCanary?.strategy?.matrix ||
  macCanary?.env ||
  macCanary?.permissions
)
  failures.push(
    'RC020: organization macOS coverage must be one bounded hosted leg while upstream stays gated',
  );
const macAcquire = macStep('acquire-build-lock');
const macBuild = macStep('build');
const macReturn = macStep('return-license');
const macRelease = macStep('release-build-lock');
const macVerify = macStep('verify-cleanup');
if (
  macStepIndex('acquire-build-lock') < 0 ||
  macStepIndex('build') !== macStepIndex('acquire-build-lock') + 1 ||
  macStepIndex('return-license') !== macStepIndex('build') + 1 ||
  macStepIndex('release-build-lock') !== macStepIndex('return-license') + 1 ||
  macStepIndex('verify-cleanup') !== macStepIndex('release-build-lock') + 1
)
  failures.push(
    'RC020: macOS must order acquire, one local build, same-runner return, release, and verification',
  );
if (
  macAcquire?.uses !==
    `Ambiguous-Interactive/ambiguous-organization-build-lock/.github/actions/acquire-build-lock-with-cleanup@${buildLockSha}` ||
  macAcquire?.with?.['runner-id'] !== '${{ runner.name }}' ||
  macAcquire?.with?.['holder-id-suffix'] !== '${{ github.job }}' ||
  macAcquire?.with?.['require-resource-lifecycle'] !== 'true' ||
  macAcquire?.with?.['minimum-release-cooldown-seconds'] !== '1' ||
  macBuild?.uses !== './' ||
  macBuild?.if !== "${{ steps.acquire-build-lock.outputs.acquired == 'true' }}" ||
  macBuild?.['continue-on-error'] !== true ||
  macBuild?.with?.unityVersion !== '2022.3.62f3' ||
  macBuild?.with?.targetPlatform !== 'StandaloneOSX'
)
  failures.push('RC020: macOS smoke must bind one reviewed build to lifecycle-aware ownership');
if (
  macReturn?.if !==
    "${{ always() && steps.acquire-build-lock.outputs.acquired == 'true' && steps.build.outputs.resourceCleanupStatus != 'confirmed' }}" ||
  macReturn?.['continue-on-error'] !== true ||
  macReturn?.['timeout-minutes'] !== 5 ||
  !macReturn?.run?.includes('dist/platforms/mac/steps/return_license.sh') ||
  !macReturn?.run?.includes('completed:0') ||
  !macReturn?.run?.includes('UNITY_BUILDER_RESOURCE_PROOF_NONCE') ||
  !macReturn?.run?.includes('UNITY_BUILDER_RESOURCE_PROOF_PATH') ||
  !macReturn?.run?.includes('resource-safe=${fallback_nonce}') ||
  !macReturn?.run?.includes('uuidgen')
)
  failures.push(
    'RC020: macOS smoke must schedule an independently bounded same-runner Unity return under always()',
  );
const macStepBudgets = macSteps.map((step) => step?.['timeout-minutes']);
if (
  macStepBudgets.some((budget) => !Number.isInteger(budget) || budget <= 0) ||
  macCanary?.['timeout-minutes'] < macStepBudgets.reduce((sum, budget) => sum + budget, 0) + 20
)
  failures.push(
    'RC020: macOS job timeout must reserve at least twenty minutes beyond every bounded lifecycle step',
  );
const macBuildSecrets = Object.keys(macBuild?.env || {}).sort();
const macReturnSecrets = Object.keys(macReturn?.env || {}).sort();
if (
  JSON.stringify(macBuildSecrets) !==
    JSON.stringify(['UNITY_EMAIL', 'UNITY_LICENSE', 'UNITY_PASSWORD', 'UNITY_SERIAL']) ||
  JSON.stringify(macReturnSecrets) !==
    JSON.stringify(['UNITY_EMAIL', 'UNITY_PASSWORD', 'UNITY_SERIAL']) ||
  macSteps.some(
    (step) =>
      step !== macAcquire &&
      step !== macRelease &&
      JSON.stringify(step).includes('BUILD_LOCK_APP_'),
  ) ||
  macSteps.some(
    (step) =>
      step !== macBuild && step !== macReturn && JSON.stringify(step).includes('secrets.UNITY_'),
  )
)
  failures.push('RC020: macOS Unity and writer credentials must stay in their exact steps');
if (
  macRelease?.uses !==
    `Ambiguous-Interactive/ambiguous-organization-build-lock/.github/actions/release-build-lock@${buildLockSha}` ||
  macRelease?.if !== '${{ always() }}' ||
  macRelease?.with?.['runner-id'] !== '${{ runner.name }}' ||
  macRelease?.with?.['holder-id-suffix'] !== '${{ github.job }}' ||
  macRelease?.with?.['holder-id'] !== '${{ steps.acquire-build-lock.outputs.holder-id }}' ||
  macRelease?.with?.['resource-cleanup-status'] !==
    "${{ steps.return-license.outputs.cleanup-status || steps.build.outputs.resourceCleanupStatus || 'unknown' }}" ||
  macRelease?.with?.['resource-health'] !==
    "${{ (steps.acquire-build-lock.outputs.resource-health == 'blocked' || steps.build.outputs.resourceHealth == 'blocked' || steps.return-license.outputs.resource-health == 'blocked') && 'blocked' || 'healthy' }}" ||
  macRelease?.with?.['resource-reason'] !==
    "${{ (steps.acquire-build-lock.outputs.resource-health == 'blocked' || steps.build.outputs.resourceHealth == 'blocked' || steps.return-license.outputs.resource-health == 'blocked') && 'unity-account-limit-20111' || steps.return-license.outputs.resource-reason || steps.build.outputs.resourceReason || steps.acquire-build-lock.outputs.resource-reason || 'cleanup-evidence-unknown' }}"
)
  failures.push('RC020: macOS release must forward the exact typed schema-5 evidence tuple');
if (
  macVerify?.if !== '${{ always() }}' ||
  macVerify?.env?.CLEANUP_STATUS !==
    '${{ steps.return-license.outputs.cleanup-status || steps.build.outputs.resourceCleanupStatus }}' ||
  macVerify?.env?.EVIDENCE_DIGEST !==
    '${{ steps.return-license.outputs.evidence-digest || steps.build.outputs.resourceEvidenceDigest }}' ||
  macVerify?.env?.RESOURCE_HEALTH !==
    "${{ (steps.acquire-build-lock.outputs.resource-health == 'blocked' || steps.build.outputs.resourceHealth == 'blocked' || steps.return-license.outputs.resource-health == 'blocked') && 'blocked' || 'healthy' }}" ||
  macVerify?.env?.RESOURCE_REASON !==
    "${{ (steps.acquire-build-lock.outputs.resource-health == 'blocked' || steps.build.outputs.resourceHealth == 'blocked' || steps.return-license.outputs.resource-health == 'blocked') && 'unity-account-limit-20111' || steps.return-license.outputs.resource-reason || steps.build.outputs.resourceReason || steps.acquire-build-lock.outputs.resource-reason }}" ||
  macVerify?.env?.RELEASED !== '${{ steps.release-build-lock.outputs.released }}' ||
  macVerify?.env?.RELEASE_CLEANUP_RESULT !==
    '${{ steps.release-build-lock.outputs.cleanup-result }}' ||
  macVerify?.env?.RELEASE_RESERVATION_STATE !==
    '${{ steps.release-build-lock.outputs.reservation-state }}' ||
  !macVerify?.run?.includes('unity-account-limit-20111') ||
  !macVerify?.run?.includes('cleanup-confirmed') ||
  !macVerify?.run?.includes('cooldown-started') ||
  !macVerify?.run?.includes('RELEASE_HOLDER_ID') ||
  !macVerify?.run?.includes('RELEASE_AVAILABLE_AT') ||
  !macVerify?.run?.includes('^[0-9a-f]{64}$') ||
  macVerify?.run?.includes('RELEASE_HELD_BY')
)
  failures.push('RC020: macOS verification must fail closed on build, cleanup, or account health');
const macVerifyScript = macVerify?.run;
if (runBashContractTests && macVerifyScript) {
  const holder =
    'Ambiguous-Interactive/unity-builder:123:boundedOrganizationMacOSCanary:boundedOrganizationMacOSCanary';
  const verifyCases = [
    ['exact successful release', {}, 0],
    [
      'blocked account',
      { RESOURCE_HEALTH: 'blocked', RESOURCE_REASON: 'unity-account-limit-20111' },
      1,
    ],
    ['failed build', { BUILD_OUTCOME: 'failure' }, 1],
    ['nonzero or missing return evidence', { CLEANUP_STATUS: 'unknown' }, 1],
    ['release step failure', { RELEASE_OUTCOME: 'failure' }, 1],
    ['holder not removed', { RELEASED: 'false' }, 1],
    ['cooldown not started', { RELEASE_CLEANUP_RESULT: 'released' }, 1],
    ['holder identity mismatch', { RELEASE_HOLDER_ID: `${holder}-other` }, 1],
    ['another holder remains', { RELEASE_HELD_BY: `${holder}-other-run` }, 0],
    ['missing cooldown timestamp', { RELEASE_AVAILABLE_AT: '' }, 1],
    ['malformed digest', { EVIDENCE_DIGEST: 'not-a-digest' }, 1],
  ];
  const validEnvironment = {
    ACQUIRED: 'true',
    BUILD_OUTCOME: 'success',
    CLEANUP_STATUS: 'confirmed',
    EVIDENCE_DIGEST: 'a'.repeat(64),
    ACQUIRE_HOLDER_ID: holder,
    RELEASE_AVAILABLE_AT: '2026-07-19T12:00:00.000Z',
    RELEASE_CLEANUP_RESULT: 'cooldown-started',
    RELEASE_HELD_BY: '',
    RELEASE_HOLDER_ID: holder,
    RELEASE_OUTCOME: 'success',
    RELEASED: 'true',
    RELEASE_RESERVATION_STATE: 'cooldown',
    RESOURCE_HEALTH: 'healthy',
    RESOURCE_REASON: 'cleanup-confirmed',
  };
  for (const [name, overrides, expected] of verifyCases) {
    const result = spawnSync('bash', ['-c', macVerifyScript], {
      env: { ...process.env, ...validEnvironment, ...overrides },
      encoding: 'utf8',
    });
    if (result.status !== expected)
      failures.push(
        `RC020: macOS verification case ${name} expected ${expected}, got ${result.status}: ${result.stdout}${result.stderr}`,
      );
  }
}
if (
  macAggregate?.if !== '${{ always() }}' ||
  JSON.stringify(macAggregate?.needs) !==
    JSON.stringify([
      'resource-cleanup-proof-contract',
      'boundedOrganizationMacOSCanary',
      'buildForAllPlatformsMacOS',
    ]) ||
  !macAggregate?.steps?.[0]?.run?.includes('No licensed macOS coverage was requested')
)
  failures.push('RC020: macOS workflow needs one stable always-reporting aggregate');
const macAggregateScript = macAggregate?.steps?.[0]?.run;
if (runBashContractTests && macAggregateScript) {
  const aggregateCases = [
    [
      'organization contract',
      'Ambiguous-Interactive/unity-builder',
      'contract-only',
      'skipped',
      'success',
      'skipped',
      0,
    ],
    [
      'organization smoke',
      'Ambiguous-Interactive/unity-builder',
      'smoke',
      'success',
      'success',
      'skipped',
      0,
    ],
    [
      'skipped required smoke',
      'Ambiguous-Interactive/unity-builder',
      'smoke',
      'skipped',
      'success',
      'skipped',
      1,
    ],
    [
      'failed required smoke',
      'Ambiguous-Interactive/unity-builder',
      'smoke',
      'failure',
      'success',
      'skipped',
      1,
    ],
    [
      'cancelled required smoke',
      'Ambiguous-Interactive/unity-builder',
      'smoke',
      'cancelled',
      'success',
      'skipped',
      1,
    ],
    [
      'failed cleanup contract',
      'Ambiguous-Interactive/unity-builder',
      'contract-only',
      'skipped',
      'failure',
      'skipped',
      1,
    ],
    [
      'upstream full matrix',
      'game-ci/unity-builder',
      'upstream-full',
      'skipped',
      'success',
      'success',
      0,
    ],
    [
      'failed upstream matrix',
      'game-ci/unity-builder',
      'upstream-full',
      'skipped',
      'success',
      'failure',
      1,
    ],
    [
      'upstream contract skips licensed matrix',
      'game-ci/unity-builder',
      'contract-only',
      'skipped',
      'success',
      'skipped',
      0,
    ],
    ['unenrolled repository', 'example/fork', 'contract-only', 'skipped', 'success', 'skipped', 1],
  ];
  for (const [name, repository, mode, canary, contract, upstream, expected] of aggregateCases) {
    const result = spawnSync('bash', ['-c', macAggregateScript], {
      env: {
        ...process.env,
        REPOSITORY: repository,
        MODE: mode,
        CANARY_RESULT: canary,
        CONTRACT_RESULT: contract,
        UPSTREAM_RESULT: upstream,
      },
      encoding: 'utf8',
    });
    if (
      result.status !== expected ||
      (name === 'organization contract' &&
        !result.stdout.includes('cleanup contract fixtures passed'))
    )
      failures.push(
        `RC020: macOS aggregate case ${name} expected ${expected}, got ${result.status}: ${result.stdout}${result.stderr}`,
      );
  }
}
if (
  JSON.stringify(
    macSteps.filter((step) => String(step.uses || '').startsWith('actions/upload-artifact@')),
  ).includes('runner.temp') ||
  JSON.stringify(
    macSteps.filter((step) => String(step.uses || '').startsWith('actions/upload-artifact@')),
  ).includes('unity-builder-fallback-return')
)
  failures.push('RC020: private macOS return evidence must never be uploaded');

const upstreamSync = read('.github/workflows/upstream-sync.yml');
const verifierCopies =
  upstreamSync.match(/cp .*verify-resource-cleanup-contract\.mjs .*verify\.mjs/g) || [];
const policyCopies =
  upstreamSync.match(/cp .*workflow-credential-policy\.mjs .*workflow-credential-policy\.mjs/g) ||
  [];
if (verifierCopies.length !== 2 || policyCopies.length !== verifierCopies.length)
  failures.push('RC014: every isolated upstream verifier must copy its imported policy module');

for (const [platform, file, jobName] of [
  ['macOS', '.github/workflows/build-tests-mac.yml', 'buildForAllPlatformsMacOS'],
  ['Ubuntu', '.github/workflows/build-tests-ubuntu.yml', 'buildForAllPlatformsUbuntu'],
]) {
  const workflow = parse(read(file));
  if (Object.keys(workflow.on || {}).join(',') !== 'workflow_dispatch')
    failures.push(`RC014: ${platform} build workflow must not run automatically in the fork`);
  if (
    platform === 'macOS' &&
    workflow.jobs?.[jobName]?.if !==
      "${{ github.repository == 'game-ci/unity-builder' && inputs.mode == 'upstream-full' }}"
  )
    failures.push(
      'RC014: the upstream paid-license macOS matrix must stay disabled in the organization fork',
    );
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
