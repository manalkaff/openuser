// packages/server/src/runner/__tests__/refs.test.ts
import { describe, it, expect } from 'vitest';
import { RefMap } from '../refs.js';

/**
 * We test RefMap without a real browser by passing a mock `page` object.
 * The mock tracks calls to getByRole and .nth() so we can assert correct locator derivation.
 */
function makeMockPage() {
  const locatorCalls: Array<{ role: string; name: string; nth?: number }> = [];

  const makeMockLocator = (role: string, name: string, nthIndex?: number) => {
    const locator = {
      _role: role,
      _name: name,
      _nth: nthIndex,
      nth(n: number) {
        return makeMockLocator(role, name, n);
      },
    };
    return locator;
  };

  const page = {
    getByRole(role: string, opts: { name: string }) {
      locatorCalls.push({ role, name: opts.name });
      return makeMockLocator(role, opts.name);
    },
    _calls: locatorCalls,
  };
  return page;
}

describe('RefMap', () => {
  it('builds a map from AnnotatedRefs and retrieves locators by ref id', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = makeMockPage() as any;
    const refs = [
      { ref: 'e1', role: 'link', name: 'Home', nth: 0 },
      { ref: 'e2', role: 'button', name: 'Submit', nth: 0 },
    ];

    const refMap = new RefMap();
    refMap.build(page, refs);

    const locator = refMap.get('e1');
    expect(locator).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((locator as any)._role).toBe('link');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((locator as any)._name).toBe('Home');
  });

  it('returns null for unknown refs (stale)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = makeMockPage() as any;
    const refMap = new RefMap();
    refMap.build(page, []);

    expect(refMap.get('e99')).toBeNull();
  });

  it('applies .nth() for duplicate role+name (nth=0 and nth=1)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = makeMockPage() as any;
    const refs = [
      { ref: 'e1', role: 'button', name: 'OK', nth: 0 },
      { ref: 'e2', role: 'button', name: 'OK', nth: 1 },
    ];

    const refMap = new RefMap();
    refMap.build(page, refs);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = refMap.get('e1') as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const second = refMap.get('e2') as any;

    // .nth() is ALWAYS applied so even the first occurrence gets nth(0).
    // This prevents strict-mode violations when two elements share role+name.
    expect(first._nth).toBe(0);

    // second occurrence: nth(1) applied → _nth === 1
    expect(second._nth).toBe(1);
  });

  it('clear() removes all entries', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = makeMockPage() as any;
    const refs = [{ ref: 'e1', role: 'button', name: 'Submit', nth: 0 }];
    const refMap = new RefMap();
    refMap.build(page, refs);
    expect(refMap.get('e1')).not.toBeNull();

    refMap.clear();
    expect(refMap.get('e1')).toBeNull();
  });

  it('rebuild replaces previous entries entirely', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = makeMockPage() as any;
    const refMap = new RefMap();

    refMap.build(page, [{ ref: 'e1', role: 'button', name: 'Old', nth: 0 }]);
    expect(refMap.get('e1')).not.toBeNull();

    // rebuild with a completely different set
    refMap.build(page, [{ ref: 'e1', role: 'link', name: 'New', nth: 0 }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loc = refMap.get('e1') as any;
    expect(loc._role).toBe('link');
    expect(loc._name).toBe('New');

    // old 'e2' (if it existed) gone
    expect(refMap.get('e2')).toBeNull();
  });
});
