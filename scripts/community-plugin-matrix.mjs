import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

export function buildPluginMatrix(registry, filterPattern = '', unityOverride = '') {
  if (!registry || !Array.isArray(registry.plugins)) {
    throw new Error('Community plugin registry must contain a plugins array.');
  }

  const filter = filterPattern ? new RegExp(filterPattern, 'i') : null;
  if (
    unityOverride &&
    !/^(?:[0-9]{4}|6000)\.[0-9]+(?:\.[0-9]+[abfp][0-9]+)?$/.test(unityOverride)
  ) {
    throw new Error(`Unity version override is invalid: ${unityOverride}`);
  }
  const include = [];
  for (const plugin of registry.plugins) {
    if (
      !plugin ||
      typeof plugin.name !== 'string' ||
      plugin.name.length === 0 ||
      typeof plugin.package !== 'string' ||
      plugin.package.length === 0
    ) {
      throw new Error('Every community plugin must have a non-empty name and package.');
    }
    if (filter && !filter.test(plugin.name)) continue;

    const platforms = plugin.platforms ?? ['StandaloneLinux64'];
    if (!Array.isArray(platforms) || platforms.length === 0) {
      throw new Error(`Community plugin ${plugin.name} must declare at least one platform.`);
    }
    for (const platform of platforms) {
      include.push({
        name: plugin.name,
        package: plugin.package,
        source: plugin.source ?? 'git',
        unity: unityOverride || plugin.unity || '2021.3',
        platform,
        timeout: plugin.timeout ?? 30,
      });
    }
  }
  return { include };
}

function main() {
  const registryPath = process.env.REGISTRY_PATH || 'community-plugins.yml';
  const registry = parse(readFileSync(registryPath, 'utf8'));
  const matrix = buildPluginMatrix(
    registry,
    process.env.PLUGIN_FILTER || '',
    process.env.UNITY_VERSION_OVERRIDE || '',
  );
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required.');
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `matrix=${JSON.stringify(matrix)}\ncount=${matrix.include.length}\n`,
  );
  console.log(`Found ${matrix.include.length} plugin-platform combinations to validate.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
