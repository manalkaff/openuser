import { z } from 'zod';

// RunStatus: pending | running | passed | blocked | failed | aborted
export const RunStatusSchema = z.enum(['pending', 'running', 'passed', 'blocked', 'failed', 'aborted']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

// Verdict: goal_achieved | blocked | partial
export const VerdictSchema = z.enum(['goal_achieved', 'blocked', 'partial']);
export type Verdict = z.infer<typeof VerdictSchema>;

// FindingType: functional | console | network | ux_confusion
export const FindingTypeSchema = z.enum(['functional', 'console', 'network', 'ux_confusion']);
export type FindingType = z.infer<typeof FindingTypeSchema>;

// Severity: critical | high | medium | low
export const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low']);
export type Severity = z.infer<typeof SeveritySchema>;

// FindingStatus: open | acknowledged | resolved | dismissed
export const FindingStatusSchema = z.enum(['open', 'acknowledged', 'resolved', 'dismissed']);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

// StepKind: begin | navigate | click | type | select | scroll | back | wait | screenshot
export const StepKindSchema = z.enum([
  'begin',
  'navigate',
  'click',
  'type',
  'select',
  'scroll',
  'back',
  'wait',
  'screenshot',
]);
export type StepKind = z.infer<typeof StepKindSchema>;

// TestSource: manual | agent | promoted_from_run
export const TestSourceSchema = z.enum(['manual', 'agent', 'promoted_from_run']);
export type TestSource = z.infer<typeof TestSourceSchema>;
