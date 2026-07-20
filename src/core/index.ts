/**
 * Core: agent orchestrator and task queue.
 *
 * Spawns parallel headless-browser agents, each with its own browser context,
 * and dispatches tasks from a shared queue into a shared evidence store.
 */

export type { AgentRuntime, OrchestratorOptions, TaskBase, TaskHandler } from './orchestrator.js';
export { DEFAULT_CONCURRENCY, MAX_CONCURRENCY, runOrchestrator } from './orchestrator.js';
