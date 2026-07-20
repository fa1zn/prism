/**
 * Agents: individual agent behaviors.
 *
 * Implemented:
 *   - recon: map reachable surface within scope (read-only)
 *
 * Planned:
 *   - artifact-follow: follow up on interesting artifacts surfaced by recon
 *   - verify:          confirm or refute a hypothesis with direct observation
 */

export type { ReconTask } from './recon.js';
export { handleReconTask, seedReconTasks } from './recon.js';
export type { Verdict, VerifyTask } from './verify.js';
export {
  classifyStatus,
  handleVerifyTask,
  isClientRoute,
  seedVerifyTasks,
  verdictFor,
} from './verify.js';
