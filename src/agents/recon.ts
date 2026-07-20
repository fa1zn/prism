/**
 * Recon agent.
 *
 * A read-only agent that maps an authorized target's public surface. It runs as
 * a set of small tasks the orchestrator distributes across parallel workers:
 *
 *   - visit-landing:  load the landing page; fingerprint the app; capture the
 *                     accessibility tree, links, forms, and script bundles.
 *                     Enqueues a fetch-resource task per same-origin script.
 *   - probe-path:     GET a well-known path (robots.txt, sitemap.xml, /admin...).
 *                     Paths *named inside* robots.txt/sitemap.xml become hypotheses.
 *   - fetch-resource: GET a discovered client-side JS bundle and record its size
 *                     and framework fingerprint.
 *
 * SCOPE: every request is gated by checkScope(). If checkScope() throws, the
 * agent records the attempt as a scope violation and continues with other tasks.
 *
 * This agent only READS. It discovers obvious artifacts (that the target is Juice
 * Shop, its public paths, its JS bundle). It submits no forms, sends no payloads,
 * exploits nothing, and changes no state on the target.
 */

import type { APIResponse } from 'playwright';

import type { AgentRuntime, TaskBase } from '../core/orchestrator.js';
import type { EvidenceStore } from '../evidence/store.js';
import { ensureInScope, formatBytes, pathOf, safeOrigin, workerSource } from './common.js';

/** Well-known paths the agent probes. `/.well-known/*` can't be enumerated over HTTP, so representative entries stand in. */
const COMMON_PATHS: readonly string[] = [
  '/robots.txt',
  '/sitemap.xml',
  '/admin',
  '/api',
  '/ftp',
  '/.well-known/security.txt',
  '/.well-known/change-password',
];

/** A unit of recon work. */
export type ReconTask =
  | { id: string; kind: 'visit-landing'; url: string }
  | { id: string; kind: 'probe-path'; url: string }
  | { id: string; kind: 'fetch-resource'; url: string; note: string };

// Compile-time check that ReconTask satisfies the orchestrator's task contract.
const _taskShape: TaskBase = { id: '' } as ReconTask;
void _taskShape;

/** Seed tasks for a run against `target`: one landing visit plus a probe per well-known path. */
export function seedReconTasks(target: string): ReconTask[] {
  const tasks: ReconTask[] = [{ id: 'landing', kind: 'visit-landing', url: target }];
  for (const path of COMMON_PATHS) {
    tasks.push({ id: `probe:${path}`, kind: 'probe-path', url: new URL(path, target).toString() });
  }
  return tasks;
}

/** Dispatch one recon task. Returns follow-up tasks to enqueue. */
export async function handleReconTask(
  task: ReconTask,
  runtime: AgentRuntime,
  store: EvidenceStore,
): Promise<ReconTask[]> {
  switch (task.kind) {
    case 'visit-landing':
      return visitLanding(task.url, runtime, store);
    case 'probe-path':
      await probePath(task.url, runtime, store);
      return [];
    case 'fetch-resource':
      await fetchResource(task.url, task.note, runtime, store);
      return [];
  }
}

/** Evidence source tag for this agent's findings. */
function sourceFor(runtime: AgentRuntime): string {
  return workerSource('recon', runtime);
}

/** Load the landing page: fingerprint the app, capture a11y/links/forms/scripts. */
async function visitLanding(
  url: string,
  runtime: AgentRuntime,
  store: EvidenceStore,
): Promise<ReconTask[]> {
  if (!ensureInScope(url, store, sourceFor(runtime))) {
    return [];
  }
  const { page } = runtime;

  const response = await page.goto(url, { waitUntil: 'domcontentloaded' }).catch((err: unknown) => {
    throw new Error(
      `Could not load ${url}: ${(err as Error).message}\n` +
        'Is the target running? For the demo: docker run -d -p 3000:3000 bkimminich/juice-shop',
    );
  });

  const title = await page.title().catch(() => '');
  store.observe({
    category: 'page',
    title: `Loaded landing page (${response?.status() ?? 'unknown'})`,
    detail: title !== '' ? `Page title: ${title}` : 'No <title> found.',
    url,
    method: 'GET',
    status: response?.status(),
    severity: 'info',
    source: sourceFor(runtime),
    data: { title },
  });

  fingerprintApp(title, url, runtime, store);
  await captureAccessibilityTree(url, runtime, store);
  await enumerateLinks(url, runtime, store);
  await enumerateForms(url, runtime, store);
  return enumerateScripts(url, runtime, store);
}

/** Identify the application from obvious tells (the page title). Read-only fingerprinting, no probing. */
function fingerprintApp(
  title: string,
  url: string,
  runtime: AgentRuntime,
  store: EvidenceStore,
): void {
  if (/juice\s*shop/i.test(title)) {
    store.observe({
      category: 'page',
      title: 'Target identified as OWASP Juice Shop',
      detail: `The page title ("${title}") is the standard OWASP Juice Shop banner.`,
      url,
      severity: 'info',
      source: sourceFor(runtime),
    });
  } else {
    store.hypothesize({
      category: 'page',
      title: 'Application not conclusively fingerprinted',
      detail: `Landing title was "${title || '(none)'}"; no known-app signature matched. Investigate further.`,
      url,
      severity: 'info',
      source: sourceFor(runtime),
    });
  }
}

/** Snapshot the accessibility tree and record a summary (roles + node count). */
async function captureAccessibilityTree(
  url: string,
  runtime: AgentRuntime,
  store: EvidenceStore,
): Promise<void> {
  const snapshot = await runtime.page
    .locator('body')
    .ariaSnapshot()
    .catch(() => '');
  const lines = snapshot.split('\n').filter((line) => line.trim() !== '');

  const roleCounts: Record<string, number> = {};
  for (const line of lines) {
    const match = /^\s*-\s+([a-zA-Z]+)/.exec(line);
    if (match && match[1] !== undefined) {
      roleCounts[match[1]] = (roleCounts[match[1]] ?? 0) + 1;
    }
  }

  const topRoles = Object.entries(roleCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([role, n]) => `${role}:${n}`)
    .join(', ');

  store.observe({
    category: 'accessibility',
    title: `Accessibility tree: ${lines.length} nodes`,
    detail: topRoles !== '' ? `Top roles: ${topRoles}` : 'Empty or unavailable accessibility tree.',
    url,
    severity: 'info',
    source: sourceFor(runtime),
    data: { nodeCount: lines.length, roleCounts },
  });
}

/** Enumerate anchor links in the DOM and record each unique destination. */
async function enumerateLinks(
  url: string,
  runtime: AgentRuntime,
  store: EvidenceStore,
): Promise<void> {
  const hrefs = await runtime.page
    .$$eval('a[href]', (anchors) =>
      anchors.map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: (a.textContent ?? '').trim().slice(0, 80),
      })),
    )
    .catch(() => [] as Array<{ href: string; text: string }>);

  const seen = new Set<string>();
  const unique = hrefs.filter((l) => {
    if (l.href === '' || seen.has(l.href)) return false;
    seen.add(l.href);
    return true;
  });

  const cap = 100;
  for (const link of unique.slice(0, cap)) {
    store.observe({
      category: 'link',
      title: `Link: ${link.href}`,
      detail: link.text !== '' ? `Anchor text: "${link.text}"` : undefined,
      url: link.href,
      severity: 'info',
      source: sourceFor(runtime),
    });
  }

  if (unique.length > cap) {
    store.observe({
      category: 'note',
      title: `Link enumeration capped at ${cap} of ${unique.length} unique links`,
      url,
      severity: 'info',
      source: sourceFor(runtime),
    });
  }
}

/** Enumerate forms in the DOM and record each with its method, action, and fields. */
async function enumerateForms(
  url: string,
  runtime: AgentRuntime,
  store: EvidenceStore,
): Promise<void> {
  const forms = await runtime.page
    .$$eval('form', (nodes) =>
      nodes.map((form) => {
        const f = form as HTMLFormElement;
        const fields = Array.from(f.querySelectorAll('input, select, textarea')).map((el) => {
          const input = el as HTMLInputElement;
          return {
            name: input.name || input.id || '(unnamed)',
            type: input.type || el.tagName.toLowerCase(),
          };
        });
        return { action: f.action || '', method: (f.method || 'get').toUpperCase(), fields };
      }),
    )
    .catch(
      () =>
        [] as Array<{
          action: string;
          method: string;
          fields: Array<{ name: string; type: string }>;
        }>,
    );

  for (const form of forms) {
    const fieldSummary = form.fields.map((fld) => `${fld.name}:${fld.type}`).join(', ');
    store.observe({
      category: 'form',
      title: `Form (${form.method}) -> ${form.action !== '' ? form.action : '(no action)'}`,
      detail: fieldSummary !== '' ? `Fields: ${fieldSummary}` : 'No fields found.',
      url: form.action !== '' ? form.action : url,
      method: form.method,
      severity: 'info',
      source: sourceFor(runtime),
      data: { fields: form.fields },
    });
  }
}

/** Discover client-side script bundles; enqueue same-origin ones for fetching. */
async function enumerateScripts(
  url: string,
  runtime: AgentRuntime,
  store: EvidenceStore,
): Promise<ReconTask[]> {
  const srcs = await runtime.page
    .$$eval('script[src]', (scripts) => scripts.map((s) => (s as HTMLScriptElement).src))
    .catch(() => [] as string[]);

  const origin = new URL(url).origin;
  const unique = [...new Set(srcs.filter((s) => s !== ''))];
  const followUps: ReconTask[] = [];

  for (const src of unique) {
    const sameOrigin = safeOrigin(src) === origin;
    store.observe({
      category: 'resource',
      title: `Client-side script: ${src}`,
      detail: sameOrigin
        ? 'Same-origin bundle. Queued for fetch.'
        : 'Third-party script (not fetched).',
      url: src,
      severity: 'info',
      source: sourceFor(runtime),
    });
    if (sameOrigin) {
      followUps.push({
        id: `fetch:${src}`,
        kind: 'fetch-resource',
        url: src,
        note: 'client-side JS bundle',
      });
    }
  }

  return followUps;
}

/** Probe a well-known path; record the response. robots.txt/sitemap.xml contents become hypotheses. */
async function probePath(url: string, runtime: AgentRuntime, store: EvidenceStore): Promise<void> {
  if (!ensureInScope(url, store, sourceFor(runtime))) {
    return;
  }

  let response: APIResponse;
  try {
    response = await runtime.context.request.get(url, { failOnStatusCode: false });
  } catch (err) {
    store.observe({
      category: 'endpoint',
      title: `Probe failed: ${pathOf(url)}`,
      detail: (err as Error).message,
      url,
      method: 'GET',
      severity: 'info',
      source: sourceFor(runtime),
    });
    return;
  }

  const path = pathOf(url);
  const status = response.status();
  const reachable = status < 400;
  const isResource = path === '/robots.txt' || path === '/sitemap.xml';

  store.observe({
    category: isResource ? 'resource' : 'endpoint',
    title: `${path} -> ${status}`,
    detail: reachable ? 'Reachable.' : 'Not reachable / not found.',
    url,
    method: 'GET',
    status,
    severity:
      reachable && (path === '/admin' || path === '/api' || path === '/ftp') ? 'low' : 'info',
    source: sourceFor(runtime),
    data: { contentType: response.headers()['content-type'] ?? '' },
  });

  if (reachable && path === '/robots.txt') {
    await recordRobotsHypotheses(response, url, runtime, store);
  } else if (reachable && path === '/sitemap.xml') {
    await recordSitemapHypotheses(response, runtime, store);
  }
}

/** Fetch a discovered resource (a JS bundle) and record its size and framework fingerprint. */
async function fetchResource(
  url: string,
  note: string,
  runtime: AgentRuntime,
  store: EvidenceStore,
): Promise<void> {
  if (!ensureInScope(url, store, sourceFor(runtime))) {
    return;
  }

  let response: APIResponse;
  try {
    response = await runtime.context.request.get(url, { failOnStatusCode: false });
  } catch (err) {
    store.observe({
      category: 'resource',
      title: `Fetch failed: ${pathOf(url)}`,
      detail: (err as Error).message,
      url,
      method: 'GET',
      severity: 'info',
      source: sourceFor(runtime),
    });
    return;
  }

  const status = response.status();
  const body = await response.body().catch(() => Buffer.alloc(0));
  const text = body.toString('utf8');

  // Read-only framework fingerprinting from obvious markers. No exploitation.
  const hints: string[] = [];
  if (/ng-version|@angular|platformBrowserDynamic/.test(text)) hints.push('Angular');
  if (/webpackJsonp|__webpack_require__/.test(text)) hints.push('webpack');
  if (/React\.createElement|__REACT_DEVTOOLS/.test(text)) hints.push('React');

  store.observe({
    category: 'resource',
    title: `${note}: ${pathOf(url)} (${status}, ${formatBytes(body.length)})`,
    detail:
      hints.length > 0
        ? `Framework markers: ${hints.join(', ')}.`
        : 'Fetched; no framework markers matched.',
    url,
    method: 'GET',
    status,
    severity: 'info',
    source: sourceFor(runtime),
    data: { bytes: body.length, contentType: response.headers()['content-type'] ?? '', hints },
  });
}

/** Paths named in robots.txt were not visited; record them as leads to verify. */
async function recordRobotsHypotheses(
  response: APIResponse,
  robotsUrl: string,
  runtime: AgentRuntime,
  store: EvidenceStore,
): Promise<void> {
  const body = await response.text().catch(() => '');
  for (const line of body.split('\n')) {
    const match = /^\s*(Disallow|Allow):\s*(\S+)/i.exec(line);
    if (match && match[2] !== undefined && match[2] !== '/') {
      const ref = new URL(match[2], robotsUrl).toString();
      store.hypothesize({
        category: 'endpoint',
        title: `Path referenced in robots.txt: ${match[2]}`,
        detail: 'Named in robots.txt but not visited by this run. Verify before treating as real.',
        url: ref,
        severity: 'info',
        source: sourceFor(runtime),
      });
    }
  }
}

/** URLs listed in sitemap.xml were not visited; record them as leads to verify. */
async function recordSitemapHypotheses(
  response: APIResponse,
  runtime: AgentRuntime,
  store: EvidenceStore,
): Promise<void> {
  const body = await response.text().catch(() => '');
  const locs = body.match(/<loc>([^<]+)<\/loc>/gi) ?? [];
  for (const loc of locs.slice(0, 100)) {
    const url = loc.replace(/<\/?loc>/gi, '').trim();
    store.hypothesize({
      category: 'endpoint',
      title: `URL listed in sitemap.xml: ${url}`,
      detail: 'Listed in sitemap.xml but not visited by this run. Verify before treating as real.',
      url,
      severity: 'info',
      source: sourceFor(runtime),
    });
  }
}
