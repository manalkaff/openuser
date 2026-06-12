import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

function distDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}
function pkgRoot(): string {
  return resolve(distDir(), '..');
}
/** dist/ui — SvelteKit static build copied by scripts/copy-ui.mjs */
export function bundledUiDir(): string {
  return join(distDir(), 'ui');
}
/** dist/migrations — Drizzle SQL files copied at build time */
export function bundledMigrationsDir(): string {
  return join(distDir(), 'migrations');
}
/** packages/cli/skills — installed by scripts/copy-skills.mjs; shipped in `files` */
export function bundledSkillsDir(): string {
  return join(pkgRoot(), 'skills');
}
