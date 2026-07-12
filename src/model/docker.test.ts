import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Action from './action';
import Docker from './docker';

describe('Docker', () => {
  it('mounts the isolated cleanup proof directory into Windows containers', () => {
    const original = process.env.UNITY_BUILDER_RESOURCE_PROOF_DIRECTORY;
    const runnerTemp = mkdtempSync(path.join(os.tmpdir(), 'unity-builder-docker-test-'));
    process.env.UNITY_BUILDER_RESOURCE_PROOF_DIRECTORY = 'C:/runner/proof-attempt';
    try {
      const command = Docker.getWindowsCommand('unity-image', {
        actionFolder: 'C:/action',
        dockerWorkspacePath: '/github/workspace',
        runnerTempPath: runnerTemp,
        workspace: 'C:/workspace',
      });

      expect(command).toContain('--volume "C:/runner/proof-attempt":"c:/unity-resource-proof"');
    } finally {
      if (original === undefined) {
        delete process.env.UNITY_BUILDER_RESOURCE_PROOF_DIRECTORY;
      } else {
        process.env.UNITY_BUILDER_RESOURCE_PROOF_DIRECTORY = original;
      }
      rmSync(runnerTemp, { recursive: true, force: true });
    }
  });

  it.skip('runs', async () => {
    const image = 'unity-builder:2019.2.11f1-webgl';
    const parameters = {
      workspace: Action.rootFolder,
      projectPath: `${Action.rootFolder}/test-project`,
      buildName: 'someBuildName',
      buildsPath: 'build',
      method: '',
    };
    await Docker.run(image, parameters);
  });
});
