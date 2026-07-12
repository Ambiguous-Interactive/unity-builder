import * as core from '@actions/core';

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
}

export default Output;
