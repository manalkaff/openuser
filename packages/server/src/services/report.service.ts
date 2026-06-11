import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { runs, steps, findings, personas } from '../db/schema.js';

export class ReportService {
  constructor(private readonly db: DB) {}

  generateMarkdown(runId: string): string {
    const run = this.db.select().from(runs).where(eq(runs.id, runId)).get();
    if (!run) throw new Error(`Run not found: ${runId}`);

    const persona = run.personaId
      ? this.db.select().from(personas).where(eq(personas.id, run.personaId)).get()
      : null;

    const allSteps = this.db.select().from(steps).where(eq(steps.runId, runId)).orderBy(steps.idx).all();
    const allFindings = this.db.select().from(findings).where(eq(findings.runId, runId)).orderBy(findings.createdAt).all();

    const lines: string[] = [];

    lines.push(`# Run Report: ${runId}`);
    lines.push('');
    lines.push(`**Status:** ${run.status}`);
    if (run.verdict) lines.push(`**Verdict:** ${run.verdict}`);
    if (run.summary) lines.push(`**Summary:** ${run.summary}`);
    lines.push(`**Base URL:** ${run.baseUrlResolved}`);
    if (run.startedAt) lines.push(`**Started:** ${new Date(run.startedAt).toISOString()}`);
    if (run.finishedAt) lines.push(`**Finished:** ${new Date(run.finishedAt).toISOString()}`);
    lines.push('');

    if (persona) {
      lines.push('## Persona');
      lines.push(`**Name:** ${persona.name} (${persona.identity.roleLabel})`);
      lines.push(`**Tech savviness:** ${persona.behavior.techSavviness} | **Patience:** ${persona.behavior.patience}`);
      lines.push('');
    }

    if (allFindings.length > 0) {
      lines.push('## Findings');
      for (const finding of allFindings) {
        const icon = finding.severity === 'critical' ? '🔴' : finding.severity === 'high' ? '🟠' : finding.severity === 'medium' ? '🟡' : '🟢';
        lines.push(`### ${icon} [${finding.severity.toUpperCase()}] ${finding.title}`);
        lines.push(`**Type:** ${finding.type} | **Status:** ${finding.status}`);
        lines.push('');
        lines.push(finding.description);
        if (finding.evidence.screenshotPath) {
          lines.push('');
          lines.push(`**Screenshot:** \`${finding.evidence.screenshotPath}\``);
        }
        if (finding.evidence.consoleExcerpt && finding.evidence.consoleExcerpt.length > 0) {
          lines.push('');
          lines.push('**Console errors:**');
          lines.push('```');
          for (const e of finding.evidence.consoleExcerpt) {
            lines.push(JSON.stringify(e));
          }
          lines.push('```');
        }
        if (finding.evidence.networkExcerpt && finding.evidence.networkExcerpt.length > 0) {
          lines.push('');
          lines.push('**Network errors:**');
          for (const e of finding.evidence.networkExcerpt) {
            lines.push(`- \`${e.method} ${e.url}\` → ${e.status}${e.bodySnippet ? ': ' + e.bodySnippet : ''}`);
          }
        }
        lines.push('');
      }
    } else {
      lines.push('## Findings');
      lines.push('No findings reported.');
      lines.push('');
    }

    lines.push('## Steps');
    if (allSteps.length === 0) {
      lines.push('No steps recorded.');
    } else {
      for (const step of allSteps) {
        const statusIcon = step.status === 'error' ? '✗' : '✓';
        lines.push(`${statusIcon} **Step ${step.idx}** [\`${step.kind}\`]: ${step.description}`);
        if (step.pageUrl) lines.push(`   URL: ${step.pageUrl}`);
        if (step.note) lines.push(`   Note: ${step.note}`);
        if (step.error) lines.push(`   Error: ${step.error}`);
      }
    }
    lines.push('');

    return lines.join('\n');
  }
}
