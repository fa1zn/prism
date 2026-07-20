/**
 * Orchestrator: spawns N parallel agents against an authorized target.
 *
 * Each worker gets its own Playwright browser context and pulls tasks from a
 * shared queue until it drains. Tasks may enqueue follow-up tasks (e.g. a
 * landing-page visit discovering script bundles to fetch). All workers record
 * into one shared EvidenceStore.
 *
 * The orchestrator is agent-agnostic: it knows how to run a browser, a queue,
 * and the scope guard. What a task *means* is supplied by the caller via
 * `seedTasks` + `handleTask` (see src/agents/recon.ts).
 *
 * SCOPE: every context carries a route handler that runs checkScope() on every
 * request the browser makes; anything off the allowlist is aborted and recorded.
 * Individual task handlers additionally gate their own requests.
 */

import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page, Route } from 'playwright';

import type { EvidenceStore } from '../evidence/store.js';
import { checkScope, ScopeViolationError } from '../scope/index.js';

/** The minimum shape every task must have. */
export interface TaskBase {
  id: string;
}

/** Per-worker runtime handed to a task handler. */
export interface AgentRuntime {
  /** 1-based worker index, for logging/attribution. */
  workerId: number;
  /** This worker's own browser context. */
  context: BrowserContext;
  /** A reusable page in that context. */
  page: Page;
}

/** A task handler runs one task and returns any follow-up tasks to enqueue. */
export type TaskHandler<T extends TaskBase> = (
  task: T,
  runtime: AgentRuntime,
  store: EvidenceStore,
) => Promise<T[]>;

/** Default number of parallel agents for the demo. */
export const DEFAULT_CONCURRENCY = 3;
/** Hard ceiling on parallel agents. */
export const MAX_CONCURRENCY = 10;

/** Options for {@link runOrchestrator}. */
export interface OrchestratorOptions<T extends TaskBase> {
  /** Target base URL, used for the scope pre-check and reporting. */
  target: string;
  /** Shared store all workers record into. */
  store: EvidenceStore;
  /** Tasks to seed the queue with. */
  seedTasks: T[];
  /** How to run one task. */
  handleTask: TaskHandler<T>;
  /** Parallel agents. Defaults to {@link DEFAULT_CONCURRENCY}; clamped to 1..{@link MAX_CONCURRENCY}. */
  concurrency?: number;
  /** Run browsers headless. Defaults to `true`. */
  headless?: boolean;
  /** Per-operation timeout (ms). Defaults to `15000`. */
  timeoutMs?: number;
}

/**
 * A shared work queue that tracks in-flight tasks so workers know when the whole
 * run is genuinely drained (queue empty *and* nobody is still producing).
 *
 * Exported for testing; the orchestrator owns the only production instance.
 */
export class TaskQueue<T extends TaskBase> {
  private readonly items: T[] = [];
  private inFlight = 0;

  constructor(seed: T[]) {
    this.items.push(...seed);
  }

  add(task: T): void {
    this.items.push(task);
  }

  /**
   * Claim the next task, or `null` when the run is fully drained. Resolves after
   * a short wait if the queue is momentarily empty but other workers are still
   * running (and may enqueue more work).
   */
  async next(): Promise<T | null> {
    for (;;) {
      const task = this.items.shift();
      if (task !== undefined) {
        this.inFlight += 1;
        return task;
      }
      if (this.inFlight === 0) {
        return null;
      }
      await delay(10);
    }
  }

  /** Mark the current worker's task complete. */
  done(): void {
    this.inFlight -= 1;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Install the per-context scope route guard. Off-scope requests are aborted and recorded. */
async function guardContext(context: BrowserContext, store: EvidenceStore): Promise<void> {
  await context.route('**/*', (route: Route) => {
    const url = route.request().url();
    try {
      checkScope(url);
      void route.continue();
    } catch (err) {
      if (err instanceof ScopeViolationError) {
        store.observe({
          category: 'scope-violation',
          title: `Blocked out-of-scope request to ${safeHost(url)}`,
          detail:
            'The browser tried to reach a host not on the allowlist. The scope-guard aborted it.',
          url,
          method: route.request().method(),
          severity: 'info',
          source: 'orchestrator',
        });
        void route.abort('blockedbyclient');
      } else {
        void route.abort('failed');
      }
    }
  });
}

/** Run one worker: own context + page, pull tasks until the queue drains. */
async function runWorker<T extends TaskBase>(
  workerId: number,
  browser: Browser,
  queue: TaskQueue<T>,
  options: OrchestratorOptions<T>,
): Promise<void> {
  const context = await browser.newContext();
  context.setDefaultTimeout(options.timeoutMs ?? 15_000);
  await guardContext(context, options.store);
  const page = await context.newPage();
  const runtime: AgentRuntime = { workerId, context, page };

  try {
    for (;;) {
      const task = await queue.next();
      if (task === null) {
        break;
      }
      try {
        const followUps = await options.handleTask(task, runtime, options.store);
        for (const followUp of followUps) {
          queue.add(followUp);
        }
      } catch (err) {
        // A handler should catch its own scope violations; this is a last resort
        // so one bad task never takes down the worker.
        options.store.observe({
          category: 'note',
          title: `Task ${task.id} failed`,
          detail: (err as Error).message,
          severity: 'info',
          source: `orchestrator/worker-${workerId}`,
        });
      } finally {
        queue.done();
      }
    }
  } finally {
    await context.close();
  }
}

/**
 * Run the orchestrator: launch a browser, spawn `concurrency` workers (each with
 * its own context), and process the queue to completion. Fails fast if the
 * target itself is out of scope.
 */
export async function runOrchestrator<T extends TaskBase>(
  options: OrchestratorOptions<T>,
): Promise<void> {
  // Fail fast if the target itself is not authorized.
  checkScope(options.target);

  const concurrency = clamp(options.concurrency ?? DEFAULT_CONCURRENCY, 1, MAX_CONCURRENCY);
  const queue = new TaskQueue<T>(options.seedTasks);
  const browser = await chromium.launch({ headless: options.headless ?? true });

  try {
    const workers = Array.from({ length: concurrency }, (_, i) =>
      runWorker(i + 1, browser, queue, options),
    );
    await Promise.all(workers);
  } finally {
    await browser.close();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

/** Best-effort hostname extraction for log/title messages. */
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
