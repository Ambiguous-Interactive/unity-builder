import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auditWorkflowCredentialLiterals,
  isCredentialShapedLiteral,
  renderCredentialFinding,
  renderDiagnosticComponent,
} from './workflow-credential-policy.mjs';

test('credential-shaped env literal classification is data-driven', () => {
  const cases = [
    ['CODECOV_TOKEN', '12345678-1234-4234-9234-123456789abc', true],
    ['GH_TOKEN', `ghp_${'a'.repeat(36)}`, true],
    ['SERVICE_API_KEY', 'AbCdEf0123456789AbCdEf0123456789', true],
    ['DEPLOY_PRIVATE_KEY', '-----BEGIN OPENSSH PRIVATE KEY-----', true],
    ['CODECOV_TOKEN', '${{ secrets.CODECOV_TOKEN }}', false],
    ['GH_TOKEN', '${{ github.token }}', false],
    ['GH_TOKEN', `prefix-\${{ github.token }}`, true],
    ['GH_TOKEN', `\${{ github.token }}-${'a'.repeat(32)}`, true],
    ['GH_TOKEN', '${{ steps.auth.outputs.token }}', true],
    ['GH_TOKEN', '${{ github.token || secrets.FALLBACK_TOKEN }}', true],
    ['UNITY_PASSWORD', 'integration-test-only', false],
    ['AWS_SECRET_ACCESS_KEY', 'test', false],
    ['RUN_ID', '12345678-1234-4234-9234-123456789abc', false],
  ];

  for (const [name, value, expected] of cases) {
    assert.equal(isCredentialShapedLiteral(name, value), expected, `${name} classification`);
  }
});

test('workflow audit finds top-level, job, and step env literals without returning values', () => {
  const findings = auditWorkflowCredentialLiterals(
    `
env:
  CODECOV_TOKEN: 12345678-1234-4234-9234-123456789abc
jobs:
  test:
    env:
      GH_TOKEN: \${{ github.token }}
    steps:
      - env:
          SERVICE_API_KEY: AbCdEf0123456789AbCdEf0123456789
        run: echo safe
`,
    'fixture.yml',
  );

  assert.deepEqual(findings, [
    { fileName: 'fixture.yml', name: 'CODECOV_TOKEN', path: 'env.CODECOV_TOKEN' },
    {
      fileName: 'fixture.yml',
      name: 'SERVICE_API_KEY',
      path: 'jobs.test.steps.0.env.SERVICE_API_KEY',
    },
  ]);
  assert.equal(Object.hasOwn(findings[0], 'value'), false);
});

test('workflow audit accepts references and intentionally low-entropy synthetic fixtures', () => {
  assert.deepEqual(
    auditWorkflowCredentialLiterals(
      `
jobs:
  test:
    env:
      UNITY_PASSWORD: integration-test-only
      AWS_SECRET_ACCESS_KEY: test
      GITHUB_TOKEN: \${{ secrets.GIT_PRIVATE_TOKEN }}
`,
      'safe.yml',
    ),
    [],
  );
});

test('workflow audit rejects expressions combined with credential material', () => {
  const findings = auditWorkflowCredentialLiterals(
    `
env:
  GH_TOKEN: prefix-\${{ github.token }}
  SERVICE_API_KEY: "\${{ secrets.SERVICE_API_KEY }}-${'a'.repeat(32)}"
`,
    'expression-bypass.yml',
  );

  assert.deepEqual(
    findings.map(({ name, path }) => ({ name, path })),
    [
      { name: 'GH_TOKEN', path: 'env.GH_TOKEN' },
      { name: 'SERVICE_API_KEY', path: 'env.SERVICE_API_KEY' },
    ],
  );
});

test('RC018 diagnostic rendering safely quotes hostile file names and env paths', () => {
  const credential = 'AbCdEf0123456789AbCdEf0123456789';
  const [finding] = auditWorkflowCredentialLiterals(
    `env:\n  "GH_TOKEN_::error file=target::forged\\n\\u2028": ${credential}\n`,
    '.github/workflows/hostile\n::error file=target::forged\u2029.yml',
  );
  const diagnostic = renderCredentialFinding(finding);

  assert.match(diagnostic, /^"\.github\/workflows\/hostile\\n/);
  assert.match(diagnostic, / at "env\.GH_TOKEN_/);
  assert.equal(diagnostic.includes(credential), false);
  assert.equal(diagnostic.includes('::'), false);
  for (const character of diagnostic) {
    assert.equal(
      character < ' ' || character === '\u007f' || character === '\u2028' || character === '\u2029',
      false,
      `diagnostic retained unsafe character U+${character.codePointAt(0).toString(16)}`,
    );
  }
});

test('diagnostic component renderer escapes controls, separators, colons, and annotation markers', () => {
  const rendered = renderDiagnosticComponent('quoted\r\x1b\u2028\u2029::error::');

  assert.equal(rendered, '"quoted\\r\\u001b\\u2028\\u2029\\u003a\\u003aerror\\u003a\\u003a"');
});
