import { parse } from 'yaml';

const credentialNamePattern =
  /(?:^|_)(?:API_KEY|ACCESS_KEY|CREDENTIAL|PASSWORD|PASSWD|PRIVATE_KEY|SECRET|TOKEN)(?:_|$)/i;
const credentialValuePatterns = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  /^(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,})$/,
  /^(?:AKIA|ASIA)[A-Z0-9]{16}$/,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
  /^-----BEGIN [A-Z0-9 ]+ PRIVATE KEY-----/,
  /^(?=.{32,}$)(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9+/=_-]+$/,
];

function isCredentialShapedLiteral(name, value) {
  if (!credentialNamePattern.test(name) || typeof value !== 'string') return false;

  const scalar = value.trim();
  if (!scalar) return false;
  if (/^\$\{\{\s*(?:secrets\.[A-Za-z_][A-Za-z0-9_]*|github\.token)\s*\}\}$/.test(scalar)) {
    return false;
  }
  if (scalar.includes('${{')) return true;

  return credentialValuePatterns.some((pattern) => pattern.test(scalar));
}

function findCredentialShapedEnvLiterals(document, fileName = '<workflow>') {
  const findings = [];

  function visit(value, nodePath) {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, [...nodePath, String(index)]));
      return;
    }
    if (!value || typeof value !== 'object') return;

    for (const [key, child] of Object.entries(value)) {
      const childPath = [...nodePath, key];
      if (key === 'env' && child && typeof child === 'object' && !Array.isArray(child)) {
        for (const [name, envValue] of Object.entries(child)) {
          if (isCredentialShapedLiteral(name, envValue)) {
            findings.push({ fileName, name, path: [...childPath, name].join('.') });
          }
        }
      }
      visit(child, childPath);
    }
  }

  visit(document, []);
  return findings;
}

function renderDiagnosticComponent(value) {
  return JSON.stringify(String(value))
    .replaceAll(':', '\\u003a')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function renderCredentialFinding(finding) {
  return `${renderDiagnosticComponent(finding.fileName)} has a credential-shaped literal at ${renderDiagnosticComponent(finding.path)}; use OIDC or a GitHub secret reference`;
}

function auditWorkflowCredentialLiterals(source, fileName = '<workflow>') {
  return findCredentialShapedEnvLiterals(parse(source), fileName);
}

export {
  auditWorkflowCredentialLiterals,
  findCredentialShapedEnvLiterals,
  isCredentialShapedLiteral,
  renderCredentialFinding,
  renderDiagnosticComponent,
};
