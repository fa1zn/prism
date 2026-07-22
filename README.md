# Prism

**Point it at a web app you're allowed to test. Get back a scoped, evidence-graded report.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

Prism is an autonomous web-recon tool. You give it one authorized target and an allowlist
you wrote by hand. It drives a pool of headless browsers over the target, maps what's there,
and hands you two artifacts: a Markdown report and a self-contained HTML dashboard. Every
finding is graded, either something an agent directly observed or a hypothesis it has not yet
verified, and the two are never mixed.

Two things make it worth looking at:

1. **It cannot go out of scope.** Every request passes through one chokepoint checked against
   your allowlist, and there is no runtime way to turn that off. No `--force`, no env var, no
   flag. A host you did not authorize is a host Prism will not touch.
2. **It never presents a guess as a fact.** The evidence store makes an agent declare, in the
   type system, whether a finding was observed or inferred. A separate verify pass promotes or
   refutes the guesses. The report keeps them in separate sections.

## What a run looks like

```
$ pnpm demo:juiceshop

Prism ran 3 parallel agents against http://localhost:3000 and recorded 36 findings
(30 observed, 6 hypothesized). The target was identified as OWASP Juice Shop. It found
2 reachable well-known paths and 3 client-side script bundles, and raised 6 hypothesized
leads. The verify agent checked all 6: 2 confirmed, 2 refuted, 2 client-side routes.
1 out-of-scope request was blocked by the scope-guard.

Markdown report: reports/localhost-3000-2026-07-22.md
HTML dashboard:  reports/localhost-3000-2026-07-22.html
View it with:    pnpm report:serve
```

That last line of the summary is the point. During the run an agent tried to reach a host
that was not on the allowlist, and the scope-guard aborted the request and recorded it as
evidence:

```
| E-0014 | Blocked out-of-scope request to evil.example.com |
|         The browser tried to reach a host not on the allowlist. The scope-guard aborted it. |
```

The safety property is not a promise in the README. It shows up as a line item in the report.

The HTML dashboard renders the same evidence as a theme-aware, self-contained page (inline
CSS, no external assets, so it opens or serves anywhere) with observed findings and hypotheses
in separate cards.

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
git clone https://github.com/fa1zn/prism.git
cd prism
pnpm install

# 2. Start a local, authorized target (OWASP Juice Shop)
docker run -d -p 3000:3000 bkimminich/juice-shop

# 3. Author your allowlist. Prism will not run without one.
#    The shipped example already authorizes localhost:3000.
cp targets/allowlist.example.yaml targets/allowlist.yaml

# 4. Run the demo
pnpm demo:juiceshop

# 5. Open the dashboard it wrote
pnpm report:serve                      # serves reports/ at http://localhost:4173
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

| Script                | Description                               |
| --------------------- | ----------------------------------------- |
| `pnpm dev`            | Run the CLI in place with tsx             |
| `pnpm build`          | Type-check (strict) and emit to `dist/`   |
| `pnpm test`           | Run the vitest suite                      |
| `pnpm lint`           | ESLint + Prettier check                   |
| `pnpm demo:juiceshop` | Run the OWASP Juice Shop demo             |
| `pnpm report:serve`   | Serve the HTML dashboards from `reports/` |

## How it works

**Orchestrator and agents.** The orchestrator (`src/core/orchestrator.ts`) launches one
browser, spawns N workers (each with its own `BrowserContext`), and feeds them tasks from
a shared queue. Tasks can enqueue follow-up tasks, so a landing-page visit that discovers
a script bundle schedules a fetch for it. The orchestrator knows about browsers, the queue,
and the scope-guard; what a task means is supplied as a pair of `seedTasks` and a
`handleTask` function. It follows fewer leads to their end rather than fingerprinting
everything shallowly, so a run produces a coherent picture of one target instead of a wall
of low-signal results.

A run has two phases. The recon agent (`src/agents/recon.ts`) maps the target and records
hypotheses (paths named in robots.txt, URLs listed in sitemap.xml). The verify agent
(`src/agents/verify.ts`) then takes those hypotheses and checks each one against the live
target, recording an observed verdict: confirmed, refuted, access-controlled, or (for SPA
hash routes an HTTP GET cannot resolve) client-route. Verification is read-only, one GET
per hypothesis, and is on by default (`--no-verify` skips it).

**Scope-guard.** Every request routes through `checkScope`, the single chokepoint for the
whole system. It throws on anything not covered by the active allowlist, and each browser
context also carries a route handler that runs the same check on every request the page
makes (navigation and subresources alike):

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
declaring which it is. Both reporters (`src/reporters/`) render the two into separate
sections and never mix them.

**Adding a behavior.** Implement a task type and a handler, then hand them to the
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

The orchestrator handles browsers, concurrency, and scope enforcement, so a behavior is just
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

The `artifact-follow` behavior named in the source is not built yet.

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
