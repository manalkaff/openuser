import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface OpenUserConfig {
  name: string;
  baseUrl: string;
  environments: { name: string; url: string }[];
}

const CONFIG_FILE = 'openuser.config.json';

export function configPath(cwd: string): string {
  return join(cwd, CONFIG_FILE);
}

export function readConfig(cwd: string): OpenUserConfig | null {
  try {
    const raw = readFileSync(configPath(cwd), 'utf8');
    return JSON.parse(raw) as OpenUserConfig;
  } catch {
    return null;
  }
}

export function writeConfig(cwd: string, config: OpenUserConfig): void {
  writeFileSync(configPath(cwd), JSON.stringify(config, null, 2) + '\n', 'utf8');
}
