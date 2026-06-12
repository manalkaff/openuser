// packages/server/src/runner/__tests__/snapshot.test.ts
import { describe, it, expect } from 'vitest';
import { annotateSnapshot } from '../snapshot.js';

const RAW_ARIA = `- document:
  - heading "Welcome" [level=1]
  - link "Home"
  - button "Submit"
  - textbox "Email address"
  - combobox "Country"
  - checkbox "Agree to terms"
  - searchbox "Search"
  - spinbutton "Quantity"
  - paragraph "Some static text"
  - radio "Option A"
  - menuitem "File"`;

describe('annotateSnapshot', () => {
  it('assigns sequential [ref=eN] only to interactive elements', () => {
    const { annotated, refs } = annotateSnapshot(RAW_ARIA);

    // interactive count: link, button, textbox, combobox, checkbox, searchbox, spinbutton, radio, menuitem = 9
    expect(refs).toHaveLength(9);

    // each ref has sequential id
    expect(refs[0]!.ref).toBe('e1');
    expect(refs[8]!.ref).toBe('e9');

    // annotated text contains markers
    expect(annotated).toContain('[ref=e1]');
    expect(annotated).toContain('[ref=e9]');

    // static elements do NOT get refs
    expect(annotated).not.toMatch(/heading.*\[ref=/);
    expect(annotated).not.toMatch(/paragraph.*\[ref=/);
  });

  it('extracts role and name from each ref', () => {
    const { refs } = annotateSnapshot(RAW_ARIA);
    const linkRef = refs.find(r => r.role === 'link');
    expect(linkRef).toBeDefined();
    expect(linkRef!.name).toBe('Home');

    const textboxRef = refs.find(r => r.role === 'textbox');
    expect(textboxRef!.name).toBe('Email address');
  });

  it('places [ref=eN] at the end of the matching line', () => {
    const { annotated } = annotateSnapshot(RAW_ARIA);
    const lines = annotated.split('\n');
    const linkLine = lines.find(l => l.includes('"Home"'));
    expect(linkLine).toBeDefined();
    expect(linkLine!.endsWith('[ref=e1]')).toBe(true);
  });

  it('handles empty/non-interactive aria snapshots gracefully', () => {
    const raw = `- document:\n  - heading "Just a title" [level=1]`;
    const { annotated, refs } = annotateSnapshot(raw);
    expect(refs).toHaveLength(0);
    expect(annotated).toBe(raw);
  });

  it('unescapes JSON-style escape sequences in accessible names', () => {
    // Playwright serialises `Say "Hello"` as `Say \"Hello\"` in the aria snapshot.
    const raw = `- document:\n  - button "Say \\"Hello\\""`;
    const { refs } = annotateSnapshot(raw);
    expect(refs).toHaveLength(1);
    // The stored name must be the true unescaped string so getByRole receives it.
    expect(refs[0]!.name).toBe('Say "Hello"');
  });

  it('handles duplicate role+name by tracking occurrence index', () => {
    const raw = `- document:
  - button "OK"
  - button "OK"
  - button "Cancel"`;
    const { refs } = annotateSnapshot(raw);
    expect(refs).toHaveLength(3);
    // first "OK" → occurrence 0, second "OK" → occurrence 1
    expect(refs[0]!.role).toBe('button');
    expect(refs[0]!.name).toBe('OK');
    expect(refs[0]!.nth).toBe(0);
    expect(refs[1]!.name).toBe('OK');
    expect(refs[1]!.nth).toBe(1);
    // "Cancel" is the first of its kind → nth 0
    expect(refs[2]!.name).toBe('Cancel');
    expect(refs[2]!.nth).toBe(0);
  });
});
