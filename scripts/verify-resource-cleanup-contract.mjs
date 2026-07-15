import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const root = path.resolve(process.argv[2] || '.');
const failures = [];
const buildLockSha = 'f39ee38533b20592aa0fdf72b3e18d07c46325f3';

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
console.log('Resource cleanup contract verified (RC001-RC017).');
