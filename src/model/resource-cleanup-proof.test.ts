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

    const evidence = ResourceCleanupProof.consume(attempt);

    expect(evidence.resourceSafe).toBe(expected);
    expect(evidence.cleanupStatus).toBe(expected ? 'confirmed' : 'unknown');
    expect(evidence.health).toBe('healthy');
    expect(evidence.reason).toBe(
      expected ? 'cleanup-confirmed' : 'return-missing-positive-evidence',
    );
    expect(process.env[ResourceCleanupProof.environmentName]).toBeUndefined();
    expect(() => readFileSync(attempt.filePath)).toThrow();
  });

  it.each([
    {
      name: 'exact macOS entitlement and ULF evidence',
      activation: '',
      returned:
        'Successfully returned the entitlement license\n' +
        '[Licensing::Client] Successfully returned ULF license with serial number: masked\n',
      status: 'completed:0',
      proof: true,
      expected: {
        resourceSafe: true,
        cleanupStatus: 'confirmed',
        health: 'healthy',
        reason: 'cleanup-confirmed',
      },
    },
    {
      name: 'exit zero without positive return evidence',
      activation: '',
      returned: 'Exiting batchmode successfully now!\n',
      status: 'completed:0',
      proof: false,
      expected: {
        resourceSafe: false,
        cleanupStatus: 'unknown',
        health: 'healthy',
        reason: 'return-missing-positive-evidence',
      },
    },
    {
      name: 'bounded return timeout',
      activation: '',
      returned: '',
      status: 'timeout',
      proof: false,
      expected: {
        resourceSafe: false,
        cleanupStatus: 'unknown',
        health: 'healthy',
        reason: 'return-timeout',
      },
    },
    {
      name: 'return termination',
      activation: '',
      returned: '',
      status: 'terminated',
      proof: false,
      expected: {
        resourceSafe: false,
        cleanupStatus: 'unknown',
        health: 'healthy',
        reason: 'return-terminated',
      },
    },
    {
      name: 'confirmed account limit takes precedence over return proof',
      activation: 'Licensing failed with error code 20111\n',
      returned:
        'Successfully returned the entitlement license\nSerial number unavailable for ULF return\n',
      status: 'completed',
      proof: true,
      expected: {
        resourceSafe: false,
        cleanupStatus: 'unknown',
        health: 'blocked',
        reason: 'unity-account-limit-20111',
      },
    },
    {
      name: 'positive lines with nonzero Unity exit',
      activation: '',
      returned:
        'Successfully returned the entitlement license\n' +
        '[Licensing::Client] Successfully returned ULF license with serial number: masked\n',
      status: 'completed:7',
      proof: true,
      expected: {
        resourceSafe: false,
        cleanupStatus: 'unknown',
        health: 'healthy',
        reason: 'return-missing-positive-evidence',
      },
    },
    {
      name: 'malformed completion status',
      activation: '',
      returned:
        'Successfully returned the entitlement license\n' +
        '[Licensing::Client] Successfully returned ULF license with serial number: masked\n',
      status: 'completed',
      proof: true,
      expected: {
        resourceSafe: false,
        cleanupStatus: 'unknown',
        health: 'healthy',
        reason: 'return-missing-positive-evidence',
      },
    },
  ])('classifies $name', ({ activation, returned, status, proof, expected }) => {
    const attempt = ResourceCleanupProof.begin(runnerTemp(), undefined, 'darwin')!;
    writeFileSync(attempt.activationLogPath, activation);
    writeFileSync(attempt.returnLogPath, returned);
    writeFileSync(attempt.statusPath, status);
    if (proof) writeFileSync(attempt.filePath, `resource-safe=${attempt.nonce}`);

    const evidence = ResourceCleanupProof.consume(attempt);

    expect(evidence).toMatchObject(expected);
    expect(evidence.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not let a nonce proof substitute for missing native return evidence', () => {
    const attempt = ResourceCleanupProof.begin(runnerTemp(), undefined, 'darwin')!;
    writeFileSync(attempt.filePath, `resource-safe=${attempt.nonce}`);

    expect(ResourceCleanupProof.consume(attempt)).toMatchObject({
      resourceSafe: false,
      cleanupStatus: 'unknown',
      health: 'healthy',
      reason: 'return-missing-positive-evidence',
    });
  });

  it('does not derive the public digest from secret-bearing log content', () => {
    const consumeWithSerial = (serial: string) => {
      const attempt = ResourceCleanupProof.begin(
        runnerTemp(),
        () => 'fixed-private-nonce',
        'darwin',
      )!;
      writeFileSync(attempt.filePath, `resource-safe=${attempt.nonce}`);
      writeFileSync(
        attempt.returnLogPath,
        `Successfully returned the entitlement license\n[Licensing::Client] Successfully returned ULF license with serial number: ${serial}\n`,
      );
      writeFileSync(attempt.statusPath, 'completed:0');
      return ResourceCleanupProof.consume(attempt).digest;
    };

    expect(consumeWithSerial('secret-one')).toBe(consumeWithSerial('secret-two'));
  });

  it.each([
    '120111',
    '201110',
    '20111',
    'unrelated diagnostic value 20111',
    'license telemetry sample 20111',
  ])('does not overmatch non-semantic account code text %s', (token) => {
    const attempt = ResourceCleanupProof.begin(runnerTemp())!;
    writeFileSync(attempt.activationLogPath, token);
    writeFileSync(attempt.returnLogPath, '');
    writeFileSync(attempt.statusPath, 'completed:0');

    expect(ResourceCleanupProof.consume(attempt).health).toBe('healthy');
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

  it('forwards the native proof path to the macOS return process', () => {
    const attempt = ResourceCleanupProof.begin(runnerTemp(), () => 'mac-nonce', 'darwin')!;

    expect(process.env[ResourceCleanupProof.containerPathEnvironmentName]).toBe(attempt.filePath);
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
      ResourceCleanupProof.consume({
        directory: '\0',
        filePath: proofPath,
        activationLogPath: path.join(root, 'activation.log'),
        returnLogPath: path.join(root, 'return.log'),
        statusPath: path.join(root, 'status'),
        nonce: 'current',
        requiresNativeReturnEvidence: false,
      }).resourceSafe,
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

  it('keeps the macOS return script coupled to private exact evidence', () => {
    const script = readFileSync(
      path.join(process.cwd(), 'dist/platforms/mac/steps/return_license.sh'),
      'utf8',
    );

    expect(script).toContain('UNITY_BUILDER_RESOURCE_RETURN_LOG_PATH');
    expect(script).toContain('UNITY_BUILDER_RESOURCE_PROOF_NONCE');
    expect(script).toContain('Successfully returned the entitlement license');
    expect(script).toContain('Successfully returned ULF license with serial number');
    expect(script).toContain('Serial number unavailable for ULF return');
    expect(script).not.toContain('-logFile -');
  });
});
