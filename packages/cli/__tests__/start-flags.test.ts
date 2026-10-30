import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import {
  registerStart,
  guardOptions,
  detachArgs,
  type StartOptions,
} from '../src/commands/start.js';

function parse(argv: string[]): StartOptions {
  const program = new Command();
  program.exitOverride();
  registerStart(program);
  const start = program.commands.find((c) => c.name() === 'start')!;
  start.action(() => {});
  program.parse(['node', 'openuser', 'start', ...argv]);
  return start.opts() as StartOptions;
}

describe('openuser start guard flags', () => {
  const argv = [
    '--seed-command',
    'factory seed base --tenant {tenant}',
    '--teardown-command',
    'factory seed drop --tenant {tenant}',
    '--lock-file',
    '/var/lock/factory/ui-sweep.lock',
    '--deny-host',
    '23bisnis.com',
    '--deny-host',
    'staging.23bisnis.com',
    '--allowed-host',
    'sweep.lan',
  ];

  it('turns the flags into server guard options', () => {
    expect(guardOptions(parse(argv))).toEqual({
      guards: {
        seedCommand: 'factory seed base --tenant {tenant}',
        teardownCommand: 'factory seed drop --tenant {tenant}',
        lockFile: '/var/lock/factory/ui-sweep.lock',
        denyHosts: ['23bisnis.com', 'staging.23bisnis.com'],
      },
      allowedHosts: ['sweep.lan'],
    });
  });

  it('leaves unset guards to config.json and the defaults', () => {
    expect(guardOptions(parse([]))).toEqual({ guards: {}, allowedHosts: [] });
  });

  it('forwards every guard flag to the detached daemon', () => {
    expect(guardOptions(parse(detachArgs(parse(argv)).slice(1)))).toEqual(
      guardOptions(parse(argv)),
    );
  });
});
