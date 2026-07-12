import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

export interface CleanupProofAttempt {
  directory: string;
  filePath: string;
  nonce: string;
}

class ResourceCleanupProof {
  static readonly environmentName = 'UNITY_BUILDER_RESOURCE_PROOF_NONCE';
  static readonly hostDirectoryEnvironmentName = 'UNITY_BUILDER_RESOURCE_PROOF_DIRECTORY';
  static readonly containerPathEnvironmentName = 'UNITY_BUILDER_RESOURCE_PROOF_PATH';
  static readonly containerPath = 'c:/unity-resource-proof/proof';

  static begin(runnerTemp: string): CleanupProofAttempt | undefined {
    if (!runnerTemp) {
      console.warn('RUNNER_TEMP is unavailable; Unity cleanup proof remains false.');
      return undefined;
    }
    try {
      const directory = mkdtempSync(path.join(runnerTemp, 'unity-cleanup-proof-'));
      const nonce = randomUUID();
      process.env[ResourceCleanupProof.environmentName] = nonce;
      process.env[ResourceCleanupProof.hostDirectoryEnvironmentName] = directory;
      process.env[ResourceCleanupProof.containerPathEnvironmentName] =
        ResourceCleanupProof.containerPath;
      return { directory, filePath: path.join(directory, 'proof'), nonce };
    } catch (error) {
      console.warn(`Unity cleanup proof setup failed; proof remains false: ${String(error)}`);
      return undefined;
    }
  }

  static consume(attempt: CleanupProofAttempt): boolean {
    let safe = false;
    try {
      safe = readFileSync(attempt.filePath, 'utf8') === `resource-safe=${attempt.nonce}`;
    } catch (error) {
      console.warn(`Unity cleanup proof could not be read; proof remains false: ${String(error)}`);
    }
    try {
      rmSync(attempt.directory, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Unity cleanup proof directory could not be removed: ${String(error)}`);
      safe = false;
    }
    delete process.env[ResourceCleanupProof.environmentName];
    delete process.env[ResourceCleanupProof.hostDirectoryEnvironmentName];
    delete process.env[ResourceCleanupProof.containerPathEnvironmentName];
    return safe;
  }
}

export default ResourceCleanupProof;
