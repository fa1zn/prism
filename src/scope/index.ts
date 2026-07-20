/**
 * Scope-guard: enforces authorized-targets-only, and is the single most
 * important module in Prism.
 *
 * Contract:
 *   - Startup calls {@link initScope}, which loads `targets/allowlist.yaml`
 *     (hard-failing if it is missing), validates it (hard-failing if any entry
 *     lacks an `authorization:` field), prints it so the operator sees exactly
 *     what they've authorized, and installs it as the active allowlist.
 *   - Every outbound HTTP request routes through {@link checkScope}. Anything
 *     off the allowlist throws {@link ScopeViolationError} and never leaves.
 *   - There is no bypass. No force flag, no env var, no CLI switch disables the
 *     check. Removing it means editing source. That is intentional.
 */

import type { Allowlist, LoadAllowlistOptions } from './allowlist.js';
import { loadAllowlist, printAllowlist } from './allowlist.js';
import { activateAllowlist } from './check.js';

export type { Allowlist, AllowlistEntry, LoadAllowlistOptions } from './allowlist.js';
export {
  DEFAULT_ALLOWLIST_PATH,
  EXAMPLE_ALLOWLIST_PATH,
  computeSignature,
  loadAllowlist,
  parseAllowlist,
  printAllowlist,
} from './allowlist.js';
export { AllowlistError, ScopeViolationError } from './errors.js';
export {
  activateAllowlist,
  checkScope,
  entryMatchesUrl,
  findMatch,
  getActiveAllowlist,
  isInScope,
} from './check.js';

/**
 * Initialize scope enforcement for a run. Loads and validates the allowlist,
 * prints it for the operator, and activates it. Any failure here should abort
 * the whole program — Prism must not run with an unverified or absent scope.
 *
 * @returns the loaded, active allowlist.
 */
export function initScope(options: LoadAllowlistOptions = {}): Allowlist {
  const allowlist = loadAllowlist(options);
  printAllowlist(allowlist);
  activateAllowlist(allowlist);
  return allowlist;
}
