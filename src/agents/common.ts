/**
 * Shared helpers for agents: the pre-request scope guard and small URL/format
 * utilities. Keeping these in one place means every agent enforces scope the
 * same way and tags evidence consistently.
 */

import type { AgentRuntime } from '../core/orchestrator.js';
import type { EvidenceStore } from '../evidence/store.js';
import { checkScope, ScopeViolationError } from '../scope/index.js';

/** Evidence source tag showing which agent and worker recorded a finding, e.g. `recon/w2`. */
export function workerSource(agent: string, runtime: AgentRuntime): string {
  return `${agent}/w${runtime.workerId}`;
}

/**
 * Guard a URL before a request. Returns `true` if it is in scope. Otherwise
 * records the refused attempt as a scope violation (tagged with `source`) and
 * returns `false`, so the caller can skip the action and move on rather than
 * throwing.
 */
export function ensureInScope(url: string, store: EvidenceStore, source: string): boolean {
  try {
    checkScope(url);
    return true;
  } catch (err) {
    if (err instanceof ScopeViolationError) {
      store.observe({
        category: 'scope-violation',
        title: `Refused out-of-scope action: ${safeHost(url)}`,
        detail: 'A task targeted a host not on the allowlist. Skipped it and continued.',
        url,
        severity: 'info',
        source,
      });
      return false;
    }
    throw err;
  }
}

/** The pathname of a URL, or the raw string if it will not parse. */
export function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** The host (with port) of a URL, or the raw string if it will not parse. */
export function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The origin of a URL, or `''` if it will not parse. */
export function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/** Human-readable byte size. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
