# Prism

**Multi-agent security research framework with mandatory scope enforcement.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

## What Prism is

Prism runs a pool of parallel, Playwright-driven agents against a single web target. Each
agent has its own headless browser context and pulls work from a shared queue: it loads
pages, reads the DOM and accessibility tree, enumerates links and forms, and probes
well-known paths. When an agent discovers something worth chasing (a script bundle, a
path named in `robots.txt`), it pivots and follows that thread. Every finding is recorded
as either an observed fact or an unverified hypothesis, and the two are never mixed.

The design principle is depth over breadth. Most scanners cover a large surface
shallowly and hand you a wall of low-signal results. Prism deliberately follows fewer
threads to their end, so a run produces a coherent picture of a target rather than a
checklist. That trade is intentional: it is built to reason about a system, not to
fingerprint everything on the internet.

The scope guarantee is the core of the project. Every outbound request is checked against
an allowlist you write by hand, and the check is not overridable at runtime. There is no
`--force` flag, no environment variable, and no CLI argument that turns it off. A target
that is not on your allowlist is a target Prism will not touch. Removing that enforcement
requires editing the source.

## Authorization

**Prism is only for testing systems you own or have explicit written permission to test.**

If you want a safe target to run it against, self-host a deliberately vulnerable practice
application:

- [OWASP Juice Shop](https://owasp.org/www-project-juice-shop/)
- [DVWA](https://github.com/digininja/DVWA)
- [WebGoat](https://owasp.org/www-project-webgoat/)
- [PortSwigger Web Security Academy](https://portswigger.net/web-security) labs

All of these are meant to be attacked and are the right way to learn on your own machine.

Unauthorized testing of systems you do not own is illegal in most jurisdictions. In the
United States that is the Computer Fraud and Abuse Act (CFAA); in the United Kingdom, the
Computer Misuse Act; other countries have their own equivalents. Prism's scope-guard is a
technical safeguard against mistakes, not a legal one. It cannot grant you permission you
do not have, and it does not shift responsibility off the operator. Staying in scope is
your job.

New to authorized testing and responsible disclosure? Start at
[disclose.io](https://disclose.io/).

## Quickstart

```bash
# 1. Clone and install
git clone https://github.com/your-org/prism.git
cd prism
pnpm install

# 2. Start a local, authorized target (OWASP Juice Shop)
docker run -d -p 3000:3000 bkimminich/juice-shop

# 3. Author your allowlist. Prism will not run without one.
#    The shipped example already authorizes localhost:3000.
cp targets/allowlist.example.yaml targets/allowlist.yaml

# 4. Run the demo
pnpm demo:juiceshop

# 5. Read the report it wrote
open reports/localhost-3000-*.md      # macOS; use `xdg-open` on Linux
```

Step 3 is deliberate. The allowlist is your written record of what you are permitted to
test, and Prism hard-fails without it. Your real `targets/allowlist.yaml` is git-ignored;
only the example is tracked.

You can also drive Prism directly:

```bash
prism demo juiceshop                          # the bundled demo
prism run --target http://localhost:3000      # any allowlisted target
prism run --target <url> --concurrency 5      # 1..10 parallel agents (default 3)
```

`run` refuses any `--target` that is not on the allowlist, before it opens a browser.

| Script                | Description                             |
| --------------------- | --------------------------------------- |
| `pnpm dev`            | Run the CLI in place with tsx           |
| `pnpm build`          | Type-check (strict) and emit to `dist/` |
| `pnpm test`           | Run the vitest suite                    |
| `pnpm lint`           | ESLint + Prettier check                 |
| `pnpm demo:juiceshop` | Run the OWASP Juice Shop demo           |

## How it works

**Orchestrator and agents.** The orchestrator (`src/core/orchestrator.ts`) launches one
browser, spawns N workers (each with its own `BrowserContext`), and feeds them tasks from
a shared queue. Tasks can enqueue follow-up tasks, so a landing-page visit that discovers
a script bundle schedules a fetch for it. The orchestrator is agent-agnostic: it knows
about browsers, the queue, and the scope-guard. What a task means is supplied by an agent
as a pair of `seedTasks` and a `handleTask` function.

A run has two phases. The recon agent (`src/agents/recon.ts`) maps the target and records
hypotheses (paths named in robots.txt, URLs listed in sitemap.xml). The verify agent
(`src/agents/verify.ts`) then takes those hypotheses and checks each one against the live
target, recording an observed verdict: confirmed, refuted, access-controlled, or (for SPA
hash routes an HTTP GET cannot resolve) client-route. Verification is read-only, one GET
per hypothesis, and is on by default (`--no-verify` skips it).

**Scope-guard.** Every request routes through `checkScope`, which is the single chokepoint
for the whole system. It throws on anything not covered by the active allowlist, and each
browser context also carries a route handler that runs the same check on every request the
page makes (navigation and subresources alike):

```ts
// src/scope/check.ts: the one chokepoint. No bypass exists.
export function checkScope(target: string | URL): AllowlistEntry {
  const url = toUrl(target);
  const match = url && findMatch(activeAllowlist, url);
  if (!match) {
    throw new ScopeViolationError(
      String(target),
      `Host is not on the allowlist. Refusing to send.`,
    );
  }
  return match;
}

// src/core/orchestrator.ts: enforced at the browser level, per context.
await context.route('**/*', (route) => {
  try {
    checkScope(route.request().url());
    route.continue();
  } catch {
    route.abort('blockedbyclient'); // and recorded as a scope violation in the evidence store
  }
});
```

If `checkScope` throws, the agent records the attempt as a scope violation and continues
with its other tasks. It does not crash, and it does not send the request.

**Evidence store.** Findings live in an `EvidenceStore` (`src/evidence/store.ts`) that
draws a hard line between what was seen and what was inferred. The distinction is enforced
in the type: the raw `record` method is private, and the only way to add a finding is
`store.observe(...)` or `store.hypothesize(...)`. An agent cannot record something without
declaring which it is. The reporter (`src/reporters/markdown.ts`) renders the two into
separate sections and never mixes them.

**Adding an agent.** Implement a task type and a handler, then hand them to the
orchestrator:

```ts
type MyTask = { id: string; kind: 'do-thing'; url: string };

const handleTask: TaskHandler<MyTask> = async (task, runtime, store) => {
  if (!ensureInScope(task.url, runtime, store)) return [];
  // ...use runtime.page / runtime.context, then:
  store.observe({ category: 'note', title: 'saw a thing', url: task.url, source: 'my-agent' });
  return []; // or return follow-up tasks to enqueue
};

await runOrchestrator({ target, store, seedTasks, handleTask });
```

The orchestrator handles browsers, concurrency, and scope enforcement, so an agent is just
"given this task and a page, what do I record."

## Roadmap

Honest and short:

- **Continual learning research.** The direction that motivates the project: agents that
  improve across a stream of practice-lab challenges, carrying what they learn from one
  target to the next, rather than starting cold each run.
- **More demo targets.** DVWA and WebGoat alongside Juice Shop, each self-hosted and
  authorized by the same allowlist mechanism.
- **Richer evidence types.** More structured findings (auth flows, API shapes, client-side
  routing) and evidence that links a hypothesis to the observations that support it.

The `artifact-follow` agent named in the source is not built yet.

## Contributing

Issues and pull requests are welcome. Keep the scope-guard non-negotiable: no change should
introduce a runtime way to disable `checkScope`. Run `pnpm lint` and `pnpm test` before
opening a PR.

## License

[MIT](./LICENSE).

## Acknowledgments

- [OWASP Juice Shop](https://owasp.org/www-project-juice-shop/) for a target that is safe
  and legal to practice against.
- [Playwright](https://playwright.dev/) for the browser automation.
- [disclose.io](https://disclose.io/) for framing responsible disclosure.
