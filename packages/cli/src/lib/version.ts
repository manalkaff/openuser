import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The version in this package's own package.json. Found by walking up from this module, so it
 * works from src/lib (tests) and from the bundled dist/index.js (the published package).
 */
export function cliVersion(from: string = dirname(fileURLToPath(import.meta.url))): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const file = join(dir, 'package.json');
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string };
      if (pkg.name === 'openuser-cli' && pkg.version) return pkg.version;
    }
    if (dirname(dir) === dir) throw new Error('openuser-cli package.json not found');
  }
}
