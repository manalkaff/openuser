// packages/server/src/runner/snapshot.ts

/** Roles that receive [ref=eN] annotation in the aria snapshot. */
const INTERACTIVE_ROLES = new Set([
  'link',
  'button',
  'textbox',
  'checkbox',
  'combobox',
  'radio',
  'menuitem',
  'option',
  'searchbox',
  'spinbutton',
]);

/**
 * One annotated interactive element extracted from an aria snapshot line.
 * `nth` is the 0-based occurrence index among all elements sharing the same role+name pair,
 * used by RefMap to build `.nth(nth)` locators for disambiguation.
 */
export interface AnnotatedRef {
  ref: string;          // e.g. "e1"
  role: string;         // e.g. "button"
  name: string;         // accessible name, e.g. "Submit"
  nth: number;          // 0-based occurrence index for this role+name pair
}

export interface AnnotateResult {
  /** Full aria outline text with [ref=eN] appended to each interactive element line. */
  annotated: string;
  /** Ordered list of refs for building the RefMap. */
  refs: AnnotatedRef[];
}

/**
 * Regex to match a single aria outline line for an interactive element.
 * Matches:   `  - button "Submit"`  or  `  - link "Home" [level=1]`
 * Capture groups: (1) leading whitespace+dash, (2) role, (3) name, (4) trailing modifiers
 *
 * The aria snapshot format from Playwright ariaSnapshot() is:
 *   <indent>- <role> "<name>"[ <extra>]
 *
 * Group 3 uses `(?:[^"\\]|\\.)*` to tolerate JSON-style escape sequences such
 * as `\"` inside the name (e.g. `- button "Say \"Hello\""`). The trailing `?`
 * on the old group 4 was redundant (.*  already matches empty) and is removed.
 */
const ARIA_LINE_RE = /^(\s*-\s+)(\w+)\s+"((?:[^"\\]|\\.)*)"(.*)$/;

/**
 * Unescape a JSON-string-content capture from the aria line regex.
 * Playwright serialises accessible names with JSON-style escaping, so a name
 * containing a literal `"` is emitted as `\"`.  We recover the true string by
 * asking JSON.parse to decode the content.  If the capture is somehow not valid
 * JSON string content (malformed snapshot), we return the raw capture unchanged
 * rather than throwing.
 */
function unescapeAriaName(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

/**
 * Post-processes a raw Playwright ariaSnapshot string:
 * - Assigns sequential [ref=eN] markers to all interactive elements.
 * - Returns both the annotated text and a structured AnnotatedRef[] list.
 *
 * The input `raw` is the string returned by:
 *   `await page.locator('body').ariaSnapshot({ timeout: 5000 })`
 *
 * This function is pure (no browser dependency) and fully synchronous.
 */
export function annotateSnapshot(raw: string): AnnotateResult {
  const lines = raw.split('\n');
  const refs: AnnotatedRef[] = [];
  const annotatedLines: string[] = [];

  // Track occurrence counts per "role:name" key for nth() disambiguation.
  const occurrenceCount = new Map<string, number>();

  let counter = 0;

  for (const line of lines) {
    const match = ARIA_LINE_RE.exec(line);
    if (match !== null) {
      const prefix = match[1] ?? '';
      const role = match[2] ?? '';
      const rawName = match[3] ?? '';
      const trailing = match[4] ?? '';
      if (INTERACTIVE_ROLES.has(role)) {
        counter += 1;
        const refId = `e${counter}`;

        // Unescape the name for locator use (e.g. `Say \"Hello\"` → `Say "Hello"`).
        const name = unescapeAriaName(rawName);

        // Occurrence tracking uses the unescaped name so role+name keys are
        // consistent with what getByRole will receive.
        const key = `${role}:${name}`;
        const nth = occurrenceCount.get(key) ?? 0;
        occurrenceCount.set(key, nth + 1);

        refs.push({ ref: refId, role, name, nth });

        // Reconstruct the line with the [ref=eN] marker appended.
        // Use rawName (the original escaped form) so the annotated output is
        // byte-identical to Playwright's aria snapshot text (display fidelity).
        // trailing may be empty string or contain extra attributes like "[level=1]".
        const reconstructed = `${prefix}${role} "${rawName}"${trailing} [ref=${refId}]`;
        annotatedLines.push(reconstructed);
        continue;
      }
    }
    annotatedLines.push(line);
  }

  return {
    annotated: annotatedLines.join('\n'),
    refs,
  };
}
