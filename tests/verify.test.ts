import { describe, expect, it } from 'vitest';

import { EvidenceStore } from '../src/evidence/store.js';
import {
  classifyStatus,
  isClientRoute,
  seedVerifyTasks,
  verdictFor,
} from '../src/agents/verify.js';

describe('verify: status classification', () => {
  it('treats 2xx/3xx as confirmed', () => {
    expect(classifyStatus(200)).toBe('confirmed');
    expect(classifyStatus(301)).toBe('confirmed');
  });

  it('treats 401/403 as access-controlled', () => {
    expect(classifyStatus(401)).toBe('access-controlled');
    expect(classifyStatus(403)).toBe('access-controlled');
  });

  it('treats 404/410 as refuted', () => {
    expect(classifyStatus(404)).toBe('refuted');
    expect(classifyStatus(410)).toBe('refuted');
  });

  it('treats other statuses as inconclusive', () => {
    expect(classifyStatus(500)).toBe('inconclusive');
    expect(classifyStatus(418)).toBe('inconclusive');
  });
});

describe('verify: client-side routes', () => {
  it('recognizes SPA hash routes on the app root', () => {
    expect(isClientRoute('http://localhost:3000/#/about')).toBe(true);
    expect(isClientRoute('http://localhost:3000/#/score-board')).toBe(true);
  });

  it('does not treat real paths as client routes', () => {
    expect(isClientRoute('http://localhost:3000/admin')).toBe(false);
    expect(isClientRoute('http://localhost:3000/ftp/')).toBe(false);
  });

  it('a hash route reports client-route regardless of HTTP status', () => {
    // GET returns the 200 app shell, but that does not confirm the route exists.
    expect(verdictFor('http://localhost:3000/#/about', 200)).toBe('client-route');
  });

  it('a real path uses its HTTP status', () => {
    expect(verdictFor('http://localhost:3000/admin', 200)).toBe('confirmed');
    expect(verdictFor('http://localhost:3000/nope', 404)).toBe('refuted');
  });
});

describe('verify: seeding from hypotheses', () => {
  it('builds one task per endpoint hypothesis and skips non-endpoints', () => {
    const store = new EvidenceStore();
    const a = store.hypothesize({
      category: 'endpoint',
      title: 'p1',
      url: 'http://localhost:3000/ftp',
      source: 't',
    });
    store.hypothesize({ category: 'endpoint', title: 'p2 (no url)', source: 't' }); // no url -> skipped
    store.hypothesize({
      category: 'page',
      title: 'not an endpoint',
      url: 'http://localhost:3000/',
      source: 't',
    });

    const tasks = seedVerifyTasks(store.hypothesized());
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.hypothesisId).toBe(a.id);
    expect(tasks[0]?.url).toBe('http://localhost:3000/ftp');
    expect(tasks[0]?.kind).toBe('verify-endpoint');
  });

  it('ignores observed findings (only hypotheses are verified)', () => {
    const store = new EvidenceStore();
    store.observe({
      category: 'endpoint',
      title: 'already seen',
      url: 'http://localhost:3000/x',
      source: 't',
    });
    expect(seedVerifyTasks(store.hypothesized())).toHaveLength(0);
  });
});
