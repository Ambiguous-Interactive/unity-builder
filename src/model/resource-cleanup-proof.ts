import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

export interface CleanupProofAttempt {
  directory: string;
  filePath: string;
  activationLogPath: string;
  returnLogPath: string;
  statusPath: string;
  nonce: string;
  requiresNativeReturnEvidence: boolean;
}

export interface ResourceCleanupEvidence {
  resourceSafe: boolean;
  cleanupStatus: 'confirmed' | 'unknown';
  health: 'healthy' | 'blocked';
  reason:
    | 'cleanup-confirmed'
    | 'cleanup-evidence-unknown'
    | 'unity-account-limit-20111'
    | 'unity-20113-unclassified'
    | 'unity-return-400006'
    | 'return-timeout'
    | 'return-log-truncated'
    | 'return-terminated'
    | 'return-missing-positive-evidence';
  digest: string;
}

class ResourceCleanupProof {
  static readonly environmentName = 'UNITY_BUILDER_RESOURCE_PROOF_NONCE';
  static readonly hostDirectoryEnvironmentName = 'UNITY_BUILDER_RESOURCE_PROOF_DIRECTORY';
  static readonly containerPathEnvironmentName = 'UNITY_BUILDER_RESOURCE_PROOF_PATH';
  static readonly activationLogEnvironmentName = 'UNITY_BUILDER_RESOURCE_ACTIVATION_LOG_PATH';
  static readonly returnLogEnvironmentName = 'UNITY_BUILDER_RESOURCE_RETURN_LOG_PATH';
  static readonly statusEnvironmentName = 'UNITY_BUILDER_RESOURCE_STATUS_PATH';
  static readonly containerPath = 'c:/unity-resource-proof/proof';
  static readonly maximumEvidenceBytes = 25 * 1024 * 1024;

  private static readonly environmentNames = [
    ResourceCleanupProof.environmentName,
    ResourceCleanupProof.hostDirectoryEnvironmentName,
    ResourceCleanupProof.containerPathEnvironmentName,
    ResourceCleanupProof.activationLogEnvironmentName,
    ResourceCleanupProof.returnLogEnvironmentName,
    ResourceCleanupProof.statusEnvironmentName,
  ];

  private static clearEnvironment() {
    for (const name of ResourceCleanupProof.environmentNames) delete process.env[name];
  }

  static begin(
    runnerTemp: string,
    nonceFactory: () => string = randomUUID,
    platform: NodeJS.Platform = process.platform,
  ): CleanupProofAttempt | undefined {
    ResourceCleanupProof.clearEnvironment();
    if (!runnerTemp) {
      console.warn('RUNNER_TEMP is unavailable; Unity cleanup proof remains false.');
      return undefined;
    }
    let directory: string | undefined;
    try {
      directory = mkdtempSync(path.join(runnerTemp, 'unity-cleanup-proof-'));
      const nonce = nonceFactory();
      process.env[ResourceCleanupProof.environmentName] = nonce;
      const attempt = {
        directory,
        filePath: path.join(directory, 'proof'),
        activationLogPath: path.join(directory, 'activation.log'),
        returnLogPath: path.join(directory, 'return.log'),
        statusPath: path.join(directory, 'return.status'),
        nonce,
        requiresNativeReturnEvidence: platform === 'darwin',
      };
      process.env[ResourceCleanupProof.hostDirectoryEnvironmentName] = directory;
      process.env[ResourceCleanupProof.containerPathEnvironmentName] =
        platform === 'darwin' ? attempt.filePath : ResourceCleanupProof.containerPath;
      process.env[ResourceCleanupProof.activationLogEnvironmentName] = attempt.activationLogPath;
      process.env[ResourceCleanupProof.returnLogEnvironmentName] = attempt.returnLogPath;
      process.env[ResourceCleanupProof.statusEnvironmentName] = attempt.statusPath;
      return attempt;
    } catch (error) {
      if (directory) {
        try {
          rmSync(directory, { recursive: true, force: true });
        } catch (cleanupError) {
          console.warn(
            `Unity cleanup proof setup directory could not be removed: ${String(cleanupError)}`,
          );
        }
      }
      ResourceCleanupProof.clearEnvironment();
      console.warn(`Unity cleanup proof setup failed; proof remains false: ${String(error)}`);
      return undefined;
    }
  }

  private static readEvidenceFile(filePath: string): {
    bytes: Buffer;
    present: boolean;
    complete: boolean;
  } {
    try {
      const metadata = lstatSync(filePath);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.size > ResourceCleanupProof.maximumEvidenceBytes
      ) {
        return { bytes: Buffer.alloc(0), present: true, complete: false };
      }
      return { bytes: readFileSync(filePath), present: true, complete: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { bytes: Buffer.alloc(0), present: false, complete: true };
      }
      return { bytes: Buffer.alloc(0), present: false, complete: false };
    }
  }

  private static returnLogProvesExactCleanup(returnText: string): boolean {
    let entitlementReturned = false;
    let ulfReturned = false;
    for (const rawLine of returnText.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (
        line === 'Successfully returned the entitlement license' ||
        line === '[Licensing::Module] Successfully returned the entitlement license'
      ) {
        entitlementReturned = true;
      }
      if (
        line === 'Serial number unavailable for ULF return' ||
        /^\[Licensing::Client\] Successfully returned ULF license with serial number\s*:\s*\S+$/.test(
          line,
        )
      ) {
        ulfReturned = true;
      }
    }
    return entitlementReturned && ulfReturned;
  }

  private static containsSemanticLicensingCode(text: string, code: '20111' | '20113'): boolean {
    const codePattern = new RegExp(`(^|[^0-9])${code}([^0-9]|$)`);
    const licensingContext = /licen[sc]|activation|entitlement/i;
    const failureContext = /error|fail|limit|maximum|blocked|return|code/i;
    return text
      .split(/\r?\n/)
      .some(
        (line) =>
          codePattern.test(line) && licensingContext.test(line) && failureContext.test(line),
      );
  }

  static consume(attempt: CleanupProofAttempt): ResourceCleanupEvidence {
    const activation = ResourceCleanupProof.readEvidenceFile(attempt.activationLogPath);
    const returned = ResourceCleanupProof.readEvidenceFile(attempt.returnLogPath);
    const status = ResourceCleanupProof.readEvidenceFile(attempt.statusPath);
    const activationText = activation.bytes.toString('utf8');
    const returnText = returned.bytes.toString('utf8');
    const combinedEvidence = `${returnText}\n${activationText}`;
    const proofSafe = (() => {
      try {
        return readFileSync(attempt.filePath, 'utf8') === `resource-safe=${attempt.nonce}`;
      } catch {
        return false;
      }
    })();
    const returnStatus = status.bytes.toString('utf8').trim();
    const captureComplete =
      activation.complete &&
      returned.complete &&
      status.complete &&
      activation.bytes.length + returned.bytes.length <= ResourceCleanupProof.maximumEvidenceBytes;
    const semantic20111 = ResourceCleanupProof.containsSemanticLicensingCode(
      combinedEvidence,
      '20111',
    );
    const semantic20113 = ResourceCleanupProof.containsSemanticLicensingCode(
      combinedEvidence,
      '20113',
    );
    const return400006 = /(^|[^0-9])400006([^0-9]|$)/.test(combinedEvidence);
    const exactReturn = ResourceCleanupProof.returnLogProvesExactCleanup(returnText);
    // Never publish a hash of secret-bearing Unity logs. The nonce binds this
    // normalized, non-secret classification to the current private attempt.
    const digest = createHash('sha256')
      .update(attempt.nonce)
      .update(
        JSON.stringify({
          activationComplete: activation.complete,
          activationPresent: activation.present,
          captureComplete,
          exactReturn,
          proofSafe,
          return400006,
          returnComplete: returned.complete,
          returnPresent: returned.present,
          returnStatus,
          semantic20111,
          semantic20113,
          statusComplete: status.complete,
          statusPresent: status.present,
        }),
      )
      .digest('hex');
    let evidence: ResourceCleanupEvidence;

    if (semantic20111) {
      evidence = {
        resourceSafe: false,
        cleanupStatus: 'unknown',
        health: 'blocked',
        reason: 'unity-account-limit-20111',
        digest,
      };
    } else if (!captureComplete) {
      evidence = {
        resourceSafe: false,
        cleanupStatus: 'unknown',
        health: 'healthy',
        reason: 'return-log-truncated',
        digest,
      };
    } else if (return400006) {
      evidence = {
        resourceSafe: false,
        cleanupStatus: 'unknown',
        health: 'healthy',
        reason: 'unity-return-400006',
        digest,
      };
    } else if (returnStatus === 'terminated') {
      evidence = {
        resourceSafe: false,
        cleanupStatus: 'unknown',
        health: 'healthy',
        reason: 'return-terminated',
        digest,
      };
    } else if (returnStatus === 'timeout') {
      evidence = {
        resourceSafe: false,
        cleanupStatus: 'unknown',
        health: 'healthy',
        reason: 'return-timeout',
        digest,
      };
    } else if (semantic20113) {
      evidence = {
        resourceSafe: false,
        cleanupStatus: 'unknown',
        health: 'healthy',
        reason: 'unity-20113-unclassified',
        digest,
      };
    } else if (
      proofSafe &&
      (attempt.requiresNativeReturnEvidence
        ? returned.present && status.bytes.toString('utf8') === 'completed:0' && exactReturn
        : !returned.present || exactReturn)
    ) {
      evidence = {
        resourceSafe: true,
        cleanupStatus: 'confirmed',
        health: 'healthy',
        reason: 'cleanup-confirmed',
        digest,
      };
    } else {
      evidence = {
        resourceSafe: false,
        cleanupStatus: 'unknown',
        health: 'healthy',
        reason: 'return-missing-positive-evidence',
        digest,
      };
    }

    try {
      rmSync(attempt.directory, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Unity cleanup proof directory could not be removed: ${String(error)}`);
      if (evidence.health === 'healthy') {
        evidence = {
          ...evidence,
          resourceSafe: false,
          cleanupStatus: 'unknown',
          reason: 'cleanup-evidence-unknown',
        };
      }
    }
    ResourceCleanupProof.clearEnvironment();
    return evidence;
  }
}

export default ResourceCleanupProof;
