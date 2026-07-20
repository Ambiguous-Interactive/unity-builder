import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll, test } from 'vitest';
import Output from './output';
import * as core from '@actions/core';

vi.mock('@actions/core');

describe('Output', () => {
  describe('setBuildVersion', () => {
    it('does not throw', async () => {
      await expect(Output.setBuildVersion('1.0.0')).resolves.not.toThrow();
    });
  });
});

describe('setResourceSafe', () => {
  it.each([
    [true, 'true'],
    [false, 'false'],
  ])('writes %s as an explicit string output', async (safe, expected) => {
    await Output.setResourceSafe(safe);

    expect(core.setOutput).toHaveBeenCalledWith('resourceSafe', expected);
  });

  it('does not mask the build when output publication fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(core.setOutput).mockImplementationOnce(() => {
      throw new Error('simulated output failure');
    });

    await expect(Output.setResourceSafe(true)).resolves.not.toThrow();
  });
});

describe('setResourceEvidence', () => {
  it('publishes the complete typed cleanup tuple and sanitized digest', async () => {
    await Output.setResourceEvidence({
      resourceSafe: true,
      cleanupStatus: 'confirmed',
      health: 'healthy',
      reason: 'cleanup-confirmed',
      digest: 'a'.repeat(64),
    });

    expect(core.setOutput).toHaveBeenCalledWith('resourceSafe', 'true');
    expect(core.setOutput).toHaveBeenCalledWith('resourceCleanupStatus', 'confirmed');
    expect(core.setOutput).toHaveBeenCalledWith('resourceHealth', 'healthy');
    expect(core.setOutput).toHaveBeenCalledWith('resourceReason', 'cleanup-confirmed');
    expect(core.setOutput).toHaveBeenCalledWith('resourceEvidenceDigest', 'a'.repeat(64));
  });
});

describe('Output', () => {
  describe('setAndroidVersionCode', () => {
    it('does not throw', async () => {
      await expect(Output.setAndroidVersionCode('1000')).resolves.not.toThrow();
    });
  });
});
