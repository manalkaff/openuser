import type { Config } from 'drizzle-kit';
import { join } from 'node:path';
import { homedir } from 'node:os';

const home = process.env['OPENUSER_HOME'] ?? join(homedir(), '.openuser');

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: join(home, 'openuser.db'),
  },
} satisfies Config;
