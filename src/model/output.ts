import * as core from '@actions/core';
import type { ResourceCleanupEvidence } from './resource-cleanup-proof';

class Output {
  static async setBuildVersion(buildVersion: string) {
    core.setOutput('buildVersion', buildVersion);
  }

  static async setAndroidVersionCode(androidVersionCode: string) {
    core.setOutput('androidVersionCode', androidVersionCode);
  }

  static async setEngineExitCode(exitCode: number) {
    core.setOutput('engineExitCode', exitCode);
  }

  static async setResourceSafe(resourceSafe: boolean) {
    try {
      core.setOutput('resourceSafe', resourceSafe ? 'true' : 'false');
    } catch (error) {
      console.warn(`Could not publish resourceSafe output: ${String(error)}`);
    }
  }

  static async setResourceEvidence(evidence: ResourceCleanupEvidence) {
    await Output.setResourceSafe(evidence.resourceSafe);
    for (const [name, value] of [
      ['resourceCleanupStatus', evidence.cleanupStatus],
      ['resourceHealth', evidence.health],
      ['resourceReason', evidence.reason],
      ['resourceEvidenceDigest', evidence.digest],
    ]) {
      try {
        core.setOutput(name, value);
      } catch (error) {
        console.warn(`Could not publish ${name} output: ${String(error)}`);
      }
    }
  }
}

export default Output;
