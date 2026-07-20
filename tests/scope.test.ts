import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  activateAllowlist,
  AllowlistError,
  checkScope,
  isInScope,
  loadAllowlist,
  parseAllowlist,
  ScopeViolationError,
  type Allowlist,
} from '../src/scope/index.js';

/** A minimal, valid allowlist covering the cases the matcher tests below need. */
const VALID_YAML = `
operator: Test Operator
targets:
  - host: localhost:3000
    authorization: OWASP Juice Shop running locally
    added_at: '2026-07-20'
  - host: app.acme.com
    authorization: I own this host
    added_at: '2026-07-20'
  - host: '*.juice-shop.local'
    authorization: Practice range I control
    added_at: '2026-07-20'
`;

function valid(): Allowlist {
  return parseAllowlist(VALID_YAML);
}

describe('allowlist loading', () => {
  it('hard-fails when the allowlist file is missing', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'prism-scope-'));
    expect(() => loadAllowlist({ cwd: emptyDir })).toThrow(AllowlistError);
    expect(() => loadAllowlist({ cwd: emptyDir })).toThrow(/No allowlist found/);
  });

  it('loads a valid allowlist from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prism-scope-'));
    mkdirSync(join(dir, 'targets'), { recursive: true });
    writeFileSync(join(dir, 'targets', 'allowlist.yaml'), VALID_YAML);

    const allowlist = loadAllowlist({ cwd: dir });
    expect(allowlist.targets).toHaveLength(3);
    expect(allowlist.operator).toBe('Test Operator');
  });
});

describe('allowlist validation', () => {
  it('refuses an entry that is missing an authorization field', () => {
    const yaml = `
targets:
  - host: localhost:3000
    added_at: '2026-07-20'
`;
    expect(() => parseAllowlist(yaml)).toThrow(AllowlistError);
    expect(() => parseAllowlist(yaml)).toThrow(/authorization/);
  });

  it('refuses an entry whose authorization is blank', () => {
    const yaml = `
targets:
  - host: localhost:3000
    authorization: '   '
    added_at: '2026-07-20'
`;
    expect(() => parseAllowlist(yaml)).toThrow(AllowlistError);
  });

  it('refuses an empty target list', () => {
    expect(() => parseAllowlist('targets: []')).toThrow(AllowlistError);
  });
});

describe('host matching (isInScope)', () => {
  it('allows an exact hostname + port match', () => {
    expect(isInScope(valid(), 'http://localhost:3000/#/login')).toBe(true);
  });

  it('rejects the right host on the wrong port when a port is pinned', () => {
    expect(isInScope(valid(), 'http://localhost:8080/')).toBe(false);
  });

  it('allows an exact hostname match (no port pinned)', () => {
    expect(isInScope(valid(), 'https://app.acme.com/dashboard')).toBe(true);
  });

  it('allows a wildcard subdomain match', () => {
    expect(isInScope(valid(), 'http://shop.juice-shop.local/')).toBe(true);
    expect(isInScope(valid(), 'http://a.b.juice-shop.local/')).toBe(true);
  });

  it('does not let a wildcard match the bare apex', () => {
    expect(isInScope(valid(), 'http://juice-shop.local/')).toBe(false);
  });

  it('rejects a host that matches nothing on the allowlist', () => {
    expect(isInScope(valid(), 'https://evil.example.com/')).toBe(false);
  });

  it('handles hostname case-insensitively (hostnames are case-insensitive)', () => {
    expect(isInScope(valid(), 'https://APP.ACME.COM/')).toBe(true);
    expect(isInScope(valid(), 'http://SHOP.Juice-Shop.Local/')).toBe(true);

    // And a pattern written in mixed case still matches a lower-case URL.
    const mixedCase = parseAllowlist(`
targets:
  - host: App.Example.COM
    authorization: I own this
    added_at: '2026-07-20'
`);
    expect(isInScope(mixedCase, 'https://app.example.com/')).toBe(true);
  });
});

describe('checkScope chokepoint', () => {
  it('returns the matching entry for an in-scope URL', () => {
    activateAllowlist(valid());
    const entry = checkScope('http://localhost:3000/#/');
    expect(entry.host).toBe('localhost:3000');
    expect(entry.authorization).toMatch(/Juice Shop/);
  });

  it('throws ScopeViolationError for an out-of-scope URL', () => {
    activateAllowlist(valid());
    expect(() => checkScope('https://evil.example.com/')).toThrow(ScopeViolationError);
  });

  it('exposes the attempted URL on the thrown error', () => {
    activateAllowlist(valid());
    try {
      checkScope('https://evil.example.com/steal');
      expect.unreachable('checkScope should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ScopeViolationError);
      expect((err as ScopeViolationError).attemptedUrl).toContain('evil.example.com');
    }
  });

  it('throws on a malformed URL rather than letting it through', () => {
    activateAllowlist(valid());
    expect(() => checkScope('not a url')).toThrow(ScopeViolationError);
  });
});
