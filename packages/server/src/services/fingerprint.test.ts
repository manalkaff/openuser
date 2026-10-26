import { describe, it, expect } from 'vitest';
import { routeTemplate, normalizeTitle, firstStackFrame, computeFingerprint } from './fingerprint.js';

describe('routeTemplate', () => {
  it('strips ids, query and trailing slash', () => {
    expect(routeTemplate('/orders/123/pay')).toBe('/orders/:id/pay');
    expect(routeTemplate('/u/550e8400-e29b-41d4-a716-446655440000/')).toBe('/u/:id');
    expect(routeTemplate('/items/ord_AbCdEf123456?tab=2#x')).toBe('/items/:id');
    expect(routeTemplate('https://shop.test/cart/9?x=1')).toBe('/cart/:id');
    expect(routeTemplate('/about-us')).toBe('/about-us');
    expect(routeTemplate(undefined)).toBe('');
  });
});

describe('normalizeTitle', () => {
  it('trims, collapses whitespace and lowercases', () => {
    expect(normalizeTitle('  Checkout   BUTTON\tdoes nothing ')).toBe('checkout button does nothing');
  });
});

describe('firstStackFrame', () => {
  it('returns the first at-line or empty', () => {
    expect(firstStackFrame('Error: x\n    at pay (app.js:1:2)\n    at go (app.js:3:4)')).toBe('at pay (app.js:1:2)');
    expect(firstStackFrame('no frames here')).toBe('');
  });
});

describe('computeFingerprint', () => {
  const base = { projectId: 'p1', route: '/orders/1/pay', category: 'functional', title: 'Pay fails', description: 'd', selector: 'button#pay' };
  it('is stable across ids, case and spacing', () => {
    expect(computeFingerprint({ ...base, route: '/orders/99/pay', title: ' pay  FAILS ' })).toBe(computeFingerprint(base));
  });
  it('differs by project, route template, category, title and selector', () => {
    const fp = computeFingerprint(base);
    expect(computeFingerprint({ ...base, projectId: 'p2' })).not.toBe(fp);
    expect(computeFingerprint({ ...base, route: '/orders/1/ship' })).not.toBe(fp);
    expect(computeFingerprint({ ...base, category: 'console' })).not.toBe(fp);
    expect(computeFingerprint({ ...base, title: 'Other' })).not.toBe(fp);
    expect(computeFingerprint({ ...base, selector: 'a#x' })).not.toBe(fp);
  });
  it('prefers the first stack frame over the selector', () => {
    const withFrame = { ...base, description: 'boom\n at pay (a.js:1:1)' };
    expect(computeFingerprint({ ...withFrame, selector: 'x' })).toBe(computeFingerprint({ ...withFrame, selector: 'y' }));
  });
});
