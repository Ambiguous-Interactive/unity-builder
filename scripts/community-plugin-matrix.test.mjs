import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { buildPluginMatrix } from './community-plugin-matrix.mjs';

const registry = {
  plugins: [
    { name: 'alpha', package: 'https://example.invalid/alpha.git' },
    {
      name: 'beta',
      package: 'com.example.beta',
      source: 'registry',
      unity: '2022.3',
      platforms: ['StandaloneWindows64', 'StandaloneOSX'],
      timeout: 45,
    },
  ],
};

test('community plugin matrix expands defaults and platforms', () => {
  assert.deepEqual(buildPluginMatrix(registry, '', ''), {
    include: [
      {
        name: 'alpha',
        package: 'https://example.invalid/alpha.git',
        source: 'git',
        unity: '2021.3',
        platform: 'StandaloneLinux64',
        timeout: 30,
      },
      {
        name: 'beta',
        package: 'com.example.beta',
        source: 'registry',
        unity: '2022.3',
        platform: 'StandaloneWindows64',
        timeout: 45,
      },
      {
        name: 'beta',
        package: 'com.example.beta',
        source: 'registry',
        unity: '2022.3',
        platform: 'StandaloneOSX',
        timeout: 45,
      },
    ],
  });
});

test('community plugin matrix applies a case-insensitive filter and version override', () => {
  assert.deepEqual(buildPluginMatrix(registry, '^BETA$', '6000.0'), {
    include: [
      {
        name: 'beta',
        package: 'com.example.beta',
        source: 'registry',
        unity: '6000.0',
        platform: 'StandaloneWindows64',
        timeout: 45,
      },
      {
        name: 'beta',
        package: 'com.example.beta',
        source: 'registry',
        unity: '6000.0',
        platform: 'StandaloneOSX',
        timeout: 45,
      },
    ],
  });
});

test('community plugin matrix rejects malformed registry data', () => {
  assert.throws(() => buildPluginMatrix({}, '', ''), /plugins array/);
  assert.throws(
    () => buildPluginMatrix({ plugins: [{ name: 'missing-package' }] }, '', ''),
    /non-empty name and package/,
  );
  assert.throws(
    () => buildPluginMatrix(registry, '', '2022.3\nEOF\necho injected'),
    /Unity version override is invalid/,
  );
});

test('community plugin workflow validates the registry without Unity credentials', () => {
  const workflow = parse(readFileSync('.github/workflows/validate-community-plugins.yml', 'utf8'));
  const registryContract = workflow.jobs['registry-contract'];
  const checkout = registryContract.steps.find((step) =>
    String(step.uses || '').startsWith('actions/checkout@'),
  );

  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(Object.keys(workflow.jobs), ['registry-contract']);
  assert.deepEqual(registryContract.permissions, { contents: 'read' });
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(JSON.stringify(registryContract).includes('uses":"./'), false);
  assert.equal(JSON.stringify(workflow).includes('secrets.UNITY_'), false);
});
