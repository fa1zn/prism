/**
 * High-level run helper shared by the CLI and the demo.
 *
 * Assumes scope has already been initialized by the caller (via `initScope`).
 * Spawns the orchestrator with the recon agent against `target`, then writes a
 * Markdown report and returns where it landed.
 */

import { handleReconTask, seedReconTasks } from './agents/recon.js';
import { handleVerifyTask, seedVerifyTasks } from './agents/verify.js';
import { DEFAULT_CONCURRENCY, MAX_CONCURRENCY, runOrchestrator } from './core/orchestrator.js';
import { EvidenceStore } from './evidence/store.js';
import { writeHtmlReport } from './reporters/html.js';
import { writeMarkdownReport } from './reporters/markdown.js';
import type { Allowlist } from './scope/index.js';
import { computeSignature } from './scope/index.js';

/** Options for {@link runReconAndReport}. */
export interface RunOptions {
  /** Authorized target base URL. */
  target: string;
  /** The active allowlist (for the report's provenance signature). */
  allowlist: Allowlist;
  /** Parallel agents. Defaults to {@link DEFAULT_CONCURRENCY}; clamped to 1..{@link MAX_CONCURRENCY}. */
  concurrency?: number;
  /** Run browsers headless. Defaults to `true`. */
  headless?: boolean;
  /** Run the verify agent after recon to check recon's hypotheses. Defaults to `true`. */
  verify?: boolean;
}

/** Result of a run. */
export interface RunResult {
  store: EvidenceStore;
  /** Path to the Markdown report. */
  reportPath: string;
  /** Path to the HTML dashboard. */
  htmlPath: string;
  concurrency: number;
  startedAt: string;
  finishedAt: string;
}

/** Run recon against `target` and write a report. */
export async function runReconAndReport(options: RunOptions): Promise<RunResult> {
  const concurrency = Math.max(
    1,
    Math.min(MAX_CONCURRENCY, Math.trunc(options.concurrency ?? DEFAULT_CONCURRENCY)),
  );
  const store = new EvidenceStore();
  const startedAt = new Date().toISOString();

  const headless = options.headless ?? true;

  // Phase 1: recon fills the store with observed facts and hypotheses.
  await runOrchestrator({
    target: options.target,
    store,
    seedTasks: seedReconTasks(options.target),
    handleTask: handleReconTask,
    concurrency,
    headless,
  });

  // Phase 2: verify recon's hypotheses, turning leads into observed verdicts.
  if (options.verify ?? true) {
    const verifyTasks = seedVerifyTasks(store.hypothesized());
    if (verifyTasks.length > 0) {
      await runOrchestrator({
        target: options.target,
        store,
        seedTasks: verifyTasks,
        handleTask: handleVerifyTask,
        concurrency,
        headless,
      });
    }
  }

  const finishedAt = new Date().toISOString();
  const reportMeta = {
    target: options.target,
    startedAt,
    finishedAt,
    allowlistSignature: computeSignature(options.allowlist),
    concurrency,
  };
  const reportPath = writeMarkdownReport(store, reportMeta);
  const htmlPath = writeHtmlReport(store, reportMeta);

  return { store, reportPath, htmlPath, concurrency, startedAt, finishedAt };
}
