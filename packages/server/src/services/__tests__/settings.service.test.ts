import { describe, it, expect } from 'vitest';
import { SettingsService } from '../settings.service.js';
import { GuardsService, DeniedHostError } from '../guards.service.js';

// Guard keys never touch the database, so no DB is needed here.
const settingsWith = (denyHosts: string[]) => new SettingsService({} as never, { denyHosts });

describe('configured denyHosts', () => {
  it('a config list without 23bisnis.com still refuses an app.23bisnis.com target', () => {
    const guards = new GuardsService(settingsWith(['other.example']));
    expect(() => guards.assertTargetAllowed(['https://app.23bisnis.com'])).toThrow(DeniedHostError);
    expect(() => guards.assertTargetAllowed(['https://shop.other.example'])).toThrow(
      DeniedHostError,
    );
  });

  it('an empty config list does not switch the production guard off', () => {
    expect(settingsWith([]).get('denyHosts')).toEqual(['23bisnis.com']);
  });

  it('adds configured hosts after the built-in list, without duplicates', () => {
    expect(settingsWith(['other.example', '23bisnis.com']).get('denyHosts')).toEqual([
      '23bisnis.com',
      'other.example',
    ]);
  });
});
