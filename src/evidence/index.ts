/**
 * Evidence store: structured record of what a run found.
 *
 * Every entry is classified as either:
 *   - observed:     directly seen in a response, DOM, or network exchange
 *   - hypothesized: inferred but not yet confirmed
 *
 * The two are never conflated. Reporters rely on this distinction.
 */

export type {
  Evidence,
  EvidenceCategory,
  EvidenceInput,
  EvidenceKind,
  FindingInput,
  Severity,
} from './store.js';
export { EvidenceStore } from './store.js';
