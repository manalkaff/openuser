// BISNIS-41 AC1: P0 item 1, fingerprint dedupe.
import { describe, it, expect, afterEach } from 'vitest';
import { startHarness, api, type Harness } from './helpers.js';

describe('BISNIS-41 acceptance', () => {
  let h: Harness;
  afterEach(async () => {
    await h.close();
  });

  it('AC1 two runs hitting the same defect give one finding row with occurrences 2', async () => {
    h = await startHarness();
    const defect = {
      type: 'functional',
      severity: 'high',
      title: 'Checkout button does nothing',
      description: 'Clicked pay, nothing happened.',
      selector: 'button#pay',
    };

    const r1 = await h.startRun();
    await h.finding(r1.token, { ...defect, route: '/orders/123/pay' });
    await h.complete(r1.token);

    // Same defect: the id in the route differs, the title differs only in case and spacing.
    const r2 = await h.startRun();
    await h.finding(r2.token, { ...defect, title: '  checkout BUTTON does nothing ', route: '/orders/98765/pay' });
    await h.complete(r2.token);

    // A different defect (different title) must stay a separate row.
    const r3 = await h.startRun();
    await h.finding(r3.token, { ...defect, title: 'Cart total is wrong', route: '/orders/55/pay' });
    await h.complete(r3.token);

    const list = await api(h.port, 'GET', `/api/findings?projectId=${h.projectId}`);
    expect(list.status).toBe(200);
    const rows = list.body as any[];
    expect(rows).toHaveLength(2);

    const dup = rows.find((r) => /checkout button/i.test(r.title))!;
    expect(dup.occurrences).toBe(2);
    expect(typeof dup.fingerprint).toBe('string');
    expect(dup.fingerprint.length).toBeGreaterThan(0);
    expect(new Date(dup.lastSeen).getTime()).toBeGreaterThanOrEqual(new Date(dup.createdAt).getTime());

    const other = rows.find((r) => /cart total/i.test(r.title))!;
    expect(other.occurrences).toBe(1);
    expect(other.fingerprint).not.toBe(dup.fingerprint);
  });
});
