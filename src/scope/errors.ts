/**
 * Scope-guard error types.
 *
 * These are deliberately distinct so callers can tell a *configuration* problem
 * (a bad or missing allowlist -> AllowlistError) apart from an *attempted
 * out-of-scope action* (ScopeViolationError). The latter is the one that must
 * never be silently swallowed.
 */

/**
 * Thrown when Prism attempts, or is asked to attempt, a request to a host that
 * is not covered by the active allowlist. There is no flag that downgrades this
 * to a warning: an out-of-scope request is a hard stop.
 */
export class ScopeViolationError extends Error {
  /** The URL (or raw string) that failed the scope check. */
  readonly attemptedUrl: string;

  constructor(attemptedUrl: string, message: string) {
    super(message);
    this.name = 'ScopeViolationError';
    this.attemptedUrl = attemptedUrl;
    // Preserve instanceof across transpilation / extending built-ins.
    Object.setPrototypeOf(this, ScopeViolationError.prototype);
  }
}

/**
 * Thrown when the allowlist itself is missing, malformed, or fails validation
 * (e.g. an entry without an `authorization:` field). Prism refuses to start.
 */
export class AllowlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllowlistError';
    Object.setPrototypeOf(this, AllowlistError.prototype);
  }
}
