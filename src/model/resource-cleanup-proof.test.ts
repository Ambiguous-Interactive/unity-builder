import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ImageEnvironmentFactory from './image-environment-factory';
import ResourceCleanupProof from './resource-cleanup-proof';

describe('ResourceCleanupProof', () => {
  const temporaryRoots: string[] = [];

  afterEach(() => {
    delete process.env[ResourceCleanupProof.environmentName];
    delete process.env[ResourceCleanupProof.hostDirectoryEnvironmentName];
    delete process.env[ResourceCleanupProof.containerPathEnvironmentName];
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function runnerTemp(): string {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'unity-builder-proof-'));
    temporaryRoots.push(directory);
    return directory;
  }

  it('creates an isolated current-attempt nonce and directory', () => {
    const attempt = ResourceCleanupProof.begin(runnerTemp())!;

    expect(attempt.nonce).toBeTruthy();
    expect(process.env[ResourceCleanupProof.environmentName]).toBe(attempt.nonce);
    expect(process.env[ResourceCleanupProof.hostDirectoryEnvironmentName]).toBe(attempt.directory);
    expect(process.env[ResourceCleanupProof.containerPathEnvironmentName]).toBe(
      ResourceCleanupProof.containerPath,
    );
    expect(() => readFileSync(attempt.filePath)).toThrow();
  });

  it.each([
    ['matching current proof', (nonce: string) => `resource-safe=${nonce}`, true],
    ['mismatched proof', () => 'resource-safe=stale', false],
    ['decorated proof', (nonce: string) => `prefix resource-safe=${nonce}`, false],
  ])('%s is classified exactly', (_name, proof, expected) => {
    const attempt = ResourceCleanupProof.begin(runnerTemp())!;
    writeFileSync(attempt.filePath, proof(attempt.nonce));

    expect(ResourceCleanupProof.consume(attempt)).toBe(expected);
    expect(process.env[ResourceCleanupProof.environmentName]).toBeUndefined();
    expect(() => readFileSync(attempt.filePath)).toThrow();
  });

  it('forwards the nonce and isolated container path', () => {
    const attempt = ResourceCleanupProof.begin(runnerTemp())!;
    const variables = ImageEnvironmentFactory.getEnvironmentVariables({} as never);

    expect(variables).toContainEqual({
      name: ResourceCleanupProof.environmentName,
      value: attempt.nonce,
    });
    expect(variables).toContainEqual({
      name: ResourceCleanupProof.containerPathEnvironmentName,
      value: ResourceCleanupProof.containerPath,
    });
  });

  it.each([
    ['missing runner temp', ''],
    ['runner temp is a file', 'file'],
  ])('keeps proof false when setup fails: %s', (_name, kind) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = runnerTemp();
    const runnerTempPath = kind === 'file' ? path.join(root, 'not-a-directory') : '';
    if (runnerTempPath) writeFileSync(runnerTempPath, 'x');

    expect(ResourceCleanupProof.begin(runnerTempPath)).toBeUndefined();
  });

  it.each([
    ['missing runner temp', ''],
    ['runner temp is a file', 'file'],
  ])('clears stale proof env vars when setup fails: %s', (_name, kind) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env[ResourceCleanupProof.environmentName] = 'stale-nonce';
    process.env[ResourceCleanupProof.hostDirectoryEnvironmentName] = '/stale/directory';
    process.env[ResourceCleanupProof.containerPathEnvironmentName] = 'c:/stale/path';

    const root = runnerTemp();
    const runnerTempPath = kind === 'file' ? path.join(root, 'not-a-directory') : '';
    if (runnerTempPath) writeFileSync(runnerTempPath, 'x');

    ResourceCleanupProof.begin(runnerTempPath);

    expect(process.env[ResourceCleanupProof.environmentName]).toBeUndefined();
    expect(process.env[ResourceCleanupProof.hostDirectoryEnvironmentName]).toBeUndefined();
    expect(process.env[ResourceCleanupProof.containerPathEnvironmentName]).toBeUndefined();
  });

  it('removes partial setup state when nonce creation fails', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = runnerTemp();

    expect(
      ResourceCleanupProof.begin(root, () => {
        throw new Error('simulated nonce failure');
      }),
    ).toBeUndefined();
    expect(readdirSync(root)).toEqual([]);
    expect(process.env[ResourceCleanupProof.environmentName]).toBeUndefined();
    expect(process.env[ResourceCleanupProof.hostDirectoryEnvironmentName]).toBeUndefined();
    expect(process.env[ResourceCleanupProof.containerPathEnvironmentName]).toBeUndefined();
  });

  it('does not throw or report safe when proof-directory cleanup fails', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = runnerTemp();
    const proofPath = path.join(root, 'proof');
    writeFileSync(proofPath, 'resource-safe=current');

    expect(
      ResourceCleanupProof.consume({ directory: '\0', filePath: proofPath, nonce: 'current' }),
    ).toBe(false);
  });

  it('keeps the Windows return script coupled to exact nonce proof', () => {
    const script = readFileSync(
      path.join(process.cwd(), 'dist/platforms/windows/return_license.ps1'),
      'utf8',
    );

    expect(script).toContain('$RETURN_LICENSE_EXIT_CODE -eq 0');
    expect(script).toContain('Remove-Item -LiteralPath $env:UNITY_BUILDER_RESOURCE_PROOF_PATH');
    expect(script).toContain('$env:UNITY_BUILDER_RESOURCE_PROOF_NONCE');
    expect(script).toContain('$env:UNITY_BUILDER_RESOURCE_PROOF_PATH');
    expect(script).toContain('[System.IO.File]::WriteAllText(');
    expect(script).toContain('"resource-safe=$env:UNITY_BUILDER_RESOURCE_PROOF_NONCE"');
  });
});
