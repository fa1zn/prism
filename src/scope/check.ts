/**
 * The scope check itself: host matching and the single {@link checkScope}
 * chokepoint every outbound request must pass through.
 *
 * There is intentionally no bypass: no "force" flag, no environment variable,
 * no CLI argument that disables the check. Removing enforcement requires editing
 * this source file. That friction is the point.
 */

import type { Allowlist, AllowlistEntry } from './allowlist.js';
import { ScopeViolationError } from './errors.js';

/** Split a `host` or `host:port` string into parts. Hostname is lower-cased (hostnames are case-insensitive). */
function splitHostPort(value: string): { host: string; port: string | null } {
  const idx = value.lastIndexOf(':');
  if (idx > -1 && /^\d+$/.test(value.slice(idx + 1))) {
    return { host: value.slice(0, idx).toLowerCase(), port: value.slice(idx + 1) };
  }
  return { host: value.toLowerCase(), port: null };
}

/**
 * Match a hostname against an allowlist pattern.
 *
 * - Exact:    `app.acme.com` matches only `app.acme.com`.
 * - Wildcard: `*.juice-shop.local` matches `a.juice-shop.local` and
 *   `a.b.juice-shop.local`, but NOT the bare apex `juice-shop.local` (a wildcard
 *   requires at least one label in front of the dot).
 *
 * Both arguments are expected pre-lower-cased by the caller.
 */
function hostMatchesPattern(pattern: string, host: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // keep the leading dot, e.g. ".juice-shop.local"
    return host.length > suffix.length && host.endsWith(suffix);
  }
  return pattern === host;
}

/** True if a single allowlist entry authorizes the given URL. */
export function entryMatchesUrl(entry: AllowlistEntry, url: URL): boolean {
  const pattern = splitHostPort(entry.host);
  const urlHost = url.hostname.toLowerCase();

  // If the entry pins a port, the URL must use exactly that port. `url.port`
  // is '' for protocol defaults, which correctly fails to match a pinned port.
  if (pattern.port !== null && url.port !== pattern.port) {
    return false;
  }

  return hostMatchesPattern(pattern.host, urlHost);
}

/** Return the first allowlist entry that authorizes `url`, or `null` if none does. */
export function findMatch(allowlist: Allowlist, url: URL): AllowlistEntry | null {
  for (const entry of allowlist.targets) {
    if (entryMatchesUrl(entry, url)) {
      return entry;
    }
  }
  return null;
}

/** Parse a string or URL into a URL, or `null` if it is malformed. */
function toUrl(target: string | URL): URL | null {
  if (target instanceof URL) {
    return target;
  }
  try {
    return new URL(target);
  } catch {
    return null;
  }
}

/** Pure predicate: is `target` in scope for `allowlist`? Does not touch global state. */
export function isInScope(allowlist: Allowlist, target: string | URL): boolean {
  const url = toUrl(target);
  return url !== null && findMatch(allowlist, url) !== null;
}

/**
 * The active allowlist. Set once at startup via {@link activateAllowlist}. Kept
 * module-private so nothing outside this module can swap it for a permissive one.
 */
let activeAllowlist: Allowlist | null = null;

/** Install the allowlist that {@link checkScope} enforces. Called during startup. */
export function activateAllowlist(allowlist: Allowlist): void {
  activeAllowlist = allowlist;
}

/** The currently active allowlist, or `null` if scope has not been initialized. */
export function getActiveAllowlist(): Allowlist | null {
  return activeAllowlist;
}

/** Write a scope violation to stderr. Every refusal is logged. */
function logViolation(error: ScopeViolationError): void {
  process.stderr.write(
    `[prism][SCOPE VIOLATION] ${error.message} (attempted: ${error.attemptedUrl})\n`,
  );
}

/**
 * The one chokepoint. Every outbound HTTP request Prism makes must call this
 * first. Returns the matching allowlist entry on success; throws
 * {@link ScopeViolationError} (and logs it) on any failure — refusing to let the
 * request proceed.
 */
export function checkScope(target: string | URL): AllowlistEntry {
  if (activeAllowlist === null) {
    const error = new ScopeViolationError(
      String(target),
      'Scope has not been initialized. initScope() must run before any request. Refusing to send.',
    );
    logViolation(error);
    throw error;
  }

  const url = toUrl(target);
  if (url === null) {
    const error = new ScopeViolationError(
      String(target),
      'Malformed URL; cannot verify scope. Refusing to send.',
    );
    logViolation(error);
    throw error;
  }

  const match = findMatch(activeAllowlist, url);
  if (match === null) {
    const error = new ScopeViolationError(
      url.toString(),
      `Host "${url.hostname}" is not on the authorized allowlist. Refusing to send.`,
    );
    logViolation(error);
    throw error;
  }

  return match;
}
