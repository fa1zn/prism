/**
 * Allowlist loading, validation, signing, and display.
 *
 * The allowlist is the operator's explicit, written declaration of what they are
 * authorized to test. Prism treats it as data, not code, and refuses to run
 * without it. Two invariants are enforced here:
 *
 *   1. The file must exist. No allowlist -> no run.
 *   2. Every entry must carry a non-empty `authorization:` field. A target you
 *      cannot justify testing is a target Prism will not touch.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { AllowlistError } from './errors.js';

/** Path (relative to the working directory) Prism loads by default. */
export const DEFAULT_ALLOWLIST_PATH = 'targets/allowlist.yaml';

/** The shipped example the operator copies to get started. */
export const EXAMPLE_ALLOWLIST_PATH = 'targets/allowlist.example.yaml';

/** A single authorized target. */
export interface AllowlistEntry {
  /** Exact hostname (`localhost`, `app.acme.com`) or wildcard (`*.juice-shop.local`). May pin a port (`localhost:3000`). */
  host: string;
  /** Free-text justification the operator wrote for why testing this host is authorized. Required. */
  authorization: string;
  /** ISO date the entry was added. */
  added_at: string;
}

/** The parsed, validated allowlist. */
export interface Allowlist {
  targets: AllowlistEntry[];
  /** Optional operator name; folded into the signature. */
  operator?: string;
  /** Optional stored SHA-256 signature, used to detect tampering. */
  signature?: string;
}

/** Options for {@link loadAllowlist}. */
export interface LoadAllowlistOptions {
  /** Working directory to resolve the default path against. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Explicit path to the allowlist file. Overrides `cwd`. */
  path?: string;
}

/**
 * Validate a single raw entry from the parsed YAML. Throws {@link AllowlistError}
 * if the entry is malformed or is missing its `authorization:` field.
 */
function validateEntry(raw: unknown, index: number): AllowlistEntry {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AllowlistError(
      `targets[${index}] must be a mapping with host/authorization/added_at.`,
    );
  }
  const record = raw as Record<string, unknown>;

  const host = record['host'];
  if (typeof host !== 'string' || host.trim() === '') {
    throw new AllowlistError(`targets[${index}] is missing a valid \`host:\`.`);
  }

  const authorization = record['authorization'];
  if (typeof authorization !== 'string' || authorization.trim() === '') {
    throw new AllowlistError(
      `targets[${index}] (host "${host}") has no \`authorization:\` field.\n` +
        'Every target must state, in your own words, why you are permitted to test it ' +
        '("I own this host", "OWASP Juice Shop running locally", "Written permission from ACME dated ...").\n' +
        'Refusing to start.',
    );
  }

  const addedAt = record['added_at'];

  return {
    host: host.trim(),
    authorization: authorization.trim(),
    added_at: typeof addedAt === 'string' ? addedAt.trim() : '',
  };
}

/**
 * Parse and validate allowlist YAML text. Kept separate from file IO so it can
 * be unit-tested directly.
 */
export function parseAllowlist(text: string): Allowlist {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (err) {
    throw new AllowlistError(`Could not parse allowlist YAML: ${(err as Error).message}`);
  }

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new AllowlistError('Allowlist must be a YAML mapping containing a `targets:` list.');
  }

  const record = doc as Record<string, unknown>;
  const rawTargets = record['targets'];
  if (!Array.isArray(rawTargets) || rawTargets.length === 0) {
    throw new AllowlistError(
      'Allowlist must contain a non-empty `targets:` list. Refusing to start with an empty scope.',
    );
  }

  const targets = rawTargets.map((raw, index) => validateEntry(raw, index));

  const allowlist: Allowlist = { targets };
  if (typeof record['operator'] === 'string' && record['operator'].trim() !== '') {
    allowlist.operator = record['operator'].trim();
  }
  if (typeof record['signature'] === 'string' && record['signature'].trim() !== '') {
    allowlist.signature = record['signature'].trim();
  }
  return allowlist;
}

/**
 * Load the allowlist from disk. Hard-fails with a helpful message if the file
 * does not exist — this is the "no allowlist, no run" gate.
 */
export function loadAllowlist(options: LoadAllowlistOptions = {}): Allowlist {
  const file = options.path ?? join(options.cwd ?? process.cwd(), DEFAULT_ALLOWLIST_PATH);

  if (!existsSync(file)) {
    throw new AllowlistError(
      `No allowlist found at ${file}.\n` +
        'Prism will not run without an explicit list of authorized targets.\n' +
        `Create ${DEFAULT_ALLOWLIST_PATH} — copy ${EXAMPLE_ALLOWLIST_PATH} and edit it for your scope.`,
    );
  }

  return parseAllowlist(readFileSync(file, 'utf8'));
}

/**
 * Compute the SHA-256 signature over the operator name plus the canonical
 * contents of the target list. Printed at startup so any edit to the scope is
 * visible as a changed signature.
 */
export function computeSignature(allowlist: Allowlist): string {
  const operator = allowlist.operator ?? '';
  const canonicalTargets = allowlist.targets.map((entry) => ({
    host: entry.host,
    authorization: entry.authorization,
    added_at: entry.added_at,
  }));
  const payload = `${operator}\n${JSON.stringify(canonicalTargets)}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Print the loaded allowlist so the operator can see exactly what they have told
 * Prism they are allowed to test, including each authorization justification and
 * the signature (with a tamper check against any stored value).
 */
export function printAllowlist(
  allowlist: Allowlist,
  out: NodeJS.WritableStream = process.stdout,
): void {
  const computed = computeSignature(allowlist);

  out.write('\n=== Prism scope: authorized targets ===\n');
  if (allowlist.operator !== undefined) {
    out.write(`operator: ${allowlist.operator}\n`);
  }
  out.write(`entries:  ${allowlist.targets.length}\n\n`);

  allowlist.targets.forEach((entry, index) => {
    out.write(`  [${index + 1}] host:          ${entry.host}\n`);
    out.write(`      authorization: ${entry.authorization}\n`);
    out.write(
      `      added_at:      ${entry.added_at !== '' ? entry.added_at : '(not recorded)'}\n\n`,
    );
  });

  out.write(`signature (sha256): ${computed}\n`);
  if (allowlist.signature === undefined) {
    out.write('signature status:   (no stored signature — add one to make tampering visible)\n');
  } else if (allowlist.signature === computed) {
    out.write('signature status:   OK (matches the value stored in the allowlist)\n');
  } else {
    out.write('signature status:   *** MISMATCH — the allowlist changed since it was signed ***\n');
    out.write(`  stored:   ${allowlist.signature}\n`);
    out.write(`  computed: ${computed}\n`);
  }

  out.write('\nPrism will refuse every request to any host not listed above.\n');
  out.write('=======================================\n\n');
}
