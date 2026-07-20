/**
 * Verify agent.
 *
 * Takes the hypotheses recon produced (paths named in robots.txt, URLs listed in
 * sitemap.xml) and checks them against the live target, turning each unconfirmed
 * lead into an observed verdict:
 *
 *   - confirmed:         the path is reachable (2xx/3xx).
 *   - access-controlled: it exists but is gated (401/403).
 *   - refuted:           it is not there (404/410).
 *   - client-route:      it is a SPA hash route; an HTTP GET only returns the app
 *                        shell, so existence cannot be confirmed this way.
 *   - inconclusive:      any other status.
 *
 * SCOPE: every request is gated by checkScope(). Out-of-scope hypotheses are
 * skipped and recorded, never fetched.
 *
 * This agent only READS. It issues a single GET per hypothesis. It does not log
 * in, submit forms, send payloads, or otherwise change state on the target.
 */

import type { APIResponse } from 'playwright';

import type { AgentRuntime, TaskBase } from '../core/orchestrator.js';
import type { Evidence, EvidenceStore, Severity } from '../evidence/store.js';
import { ensureInScope, pathOf, workerSource } from './common.js';

/** A verdict about a hypothesized path. */
export type Verdict =
  'confirmed' | 'access-controlled' | 'refuted' | 'client-route' | 'inconclusive';

/** A unit of verification work: one hypothesis to check. */
export type VerifyTask = {
  id: string;
  kind: 'verify-endpoint';
  /** The hypothesized URL to check. */
  url: string;
  /** The id of the hypothesis evidence this verifies (e.g. "E-0003"). */
  hypothesisId: string;
};

// Compile-time check that VerifyTask satisfies the orchestrator's task contract.
const _taskShape: TaskBase = { id: '' } as VerifyTask;
void _taskShape;

/**
 * Build verify tasks from a store's hypotheses. Only endpoint hypotheses (paths
 * and URLs) are checkable this way; other hypothesis categories are left alone.
 */
export function seedVerifyTasks(hypotheses: readonly Evidence[]): VerifyTask[] {
  const tasks: VerifyTask[] = [];
  for (const hypothesis of hypotheses) {
    if (hypothesis.category !== 'endpoint' || hypothesis.url === undefined) {
      continue;
    }
    tasks.push({
      id: `verify:${hypothesis.id}`,
      kind: 'verify-endpoint',
      url: hypothesis.url,
      hypothesisId: hypothesis.id,
    });
  }
  return tasks;
}

/** True if `url` is a client-side (SPA) hash route, where an HTTP GET only returns the app shell. */
export function isClientRoute(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hash !== '' && (parsed.pathname === '/' || parsed.pathname === '');
  } catch {
    return false;
  }
}

/** Classify an HTTP status into a verdict. */
export function classifyStatus(status: number): Verdict {
  if (status === 401 || status === 403) return 'access-controlled';
  if (status === 404 || status === 410) return 'refuted';
  if (status >= 200 && status < 400) return 'confirmed';
  return 'inconclusive';
}

/** The verdict for a hypothesis, accounting for SPA hash routes that GET cannot confirm. */
export function verdictFor(url: string, status: number): Verdict {
  return isClientRoute(url) ? 'client-route' : classifyStatus(status);
}

/** Human-readable label for a verdict. */
function verdictLabel(verdict: Verdict): string {
  switch (verdict) {
    case 'confirmed':
      return 'Confirmed';
    case 'access-controlled':
      return 'Confirmed (access-controlled)';
    case 'refuted':
      return 'Refuted';
    case 'client-route':
      return 'Client-side route';
    case 'inconclusive':
      return 'Inconclusive';
  }
}

/** One-line explanation for a verdict. */
function verdictDetail(verdict: Verdict, status: number): string {
  switch (verdict) {
    case 'confirmed':
      return `Reachable (HTTP ${status}). The hypothesized path exists.`;
    case 'access-controlled':
      return `Exists but is access-controlled (HTTP ${status}).`;
    case 'refuted':
      return `Not present (HTTP ${status}). The hypothesis did not hold.`;
    case 'client-route':
      return `SPA hash route; GET returns the app shell (HTTP ${status}). Existence not confirmable over HTTP.`;
    case 'inconclusive':
      return `Unexpected response (HTTP ${status}).`;
  }
}

/** Reachable admin-ish paths are worth a slightly higher triage weight. */
function severityFor(verdict: Verdict, url: string): Severity {
  const path = pathOf(url).toLowerCase();
  const sensitive = path.includes('admin') || path.includes('ftp') || path.startsWith('/rest');
  return verdict === 'confirmed' && sensitive ? 'low' : 'info';
}

/** Dispatch one verify task. */
export async function handleVerifyTask(
  task: VerifyTask,
  runtime: AgentRuntime,
  store: EvidenceStore,
): Promise<VerifyTask[]> {
  const source = workerSource('verify', runtime);
  if (!ensureInScope(task.url, store, source)) {
    return [];
  }

  let response: APIResponse;
  try {
    response = await runtime.context.request.get(task.url, { failOnStatusCode: false });
  } catch (err) {
    store.observe({
      category: 'verification',
      title: `Could not verify ${pathOf(task.url)} (${task.hypothesisId})`,
      detail: (err as Error).message,
      url: task.url,
      method: 'GET',
      severity: 'info',
      source,
      data: { verifies: task.hypothesisId, verdict: 'inconclusive' },
    });
    return [];
  }

  const status = response.status();
  const verdict = verdictFor(task.url, status);

  store.observe({
    category: 'verification',
    title: `${verdictLabel(verdict)}: ${pathOf(task.url)} (${task.hypothesisId})`,
    detail: verdictDetail(verdict, status),
    url: task.url,
    method: 'GET',
    status,
    severity: severityFor(verdict, task.url),
    source,
    data: { verifies: task.hypothesisId, verdict },
  });

  return [];
}
