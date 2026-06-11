import { z } from 'zod';

// FindingEvidence — contracts §5
export const FindingEvidenceSchema = z.object({
  screenshotPath: z.string().optional(),
  consoleExcerpt: z.array(z.unknown()).optional(),
  networkExcerpt: z
    .array(
      z.object({
        method: z.string(),
        url: z.string(),
        status: z.union([z.number(), z.literal('failed')]),
        bodySnippet: z.string().optional(),
      }),
    )
    .optional(),
});
export type FindingEvidence = z.infer<typeof FindingEvidenceSchema>;

// TesterAction — discriminated union on `kind` — contracts §5
export const TesterActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('navigate'), url: z.string().url() }),
  z.object({ kind: z.literal('click'), ref: z.string() }),
  z.object({
    kind: z.literal('type'),
    ref: z.string(),
    text: z.string(),
    submit: z.boolean().optional(),
  }),
  z.object({ kind: z.literal('select'), ref: z.string(), value: z.string() }),
  z.object({
    kind: z.literal('scroll'),
    direction: z.enum(['up', 'down']),
    amountPx: z.number().int().positive().optional(),
  }),
  z.object({ kind: z.literal('back') }),
  z.object({ kind: z.literal('wait'), seconds: z.number().int().min(1).max(30) }),
]);
export type TesterAction = z.infer<typeof TesterActionSchema>;

// PageSnapshot — contracts §5
export const PageSnapshotSchema = z.object({
  url: z.string(),
  title: z.string(),
  tree: z.string(), // a11y outline text with [ref=eN] markers
});
export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;
