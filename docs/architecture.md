# Architecture

Prism drives a pool of parallel headless-browser agents (via Playwright) over one authorized
web target with depth-first discipline, chasing one promising lead to its conclusion before
fanning out, and records what they find as structured evidence.

## Components

- **core/** — the orchestrator and task queue. Owns the agent pool, dispatches tasks from a
  shared queue, and enforces concurrency and run limits. Tasks can enqueue follow-up tasks.
- **scope/** — the scope-guard. A single chokepoint (`checkScope`) that every agent action
  and every browser request passes through; it denies anything outside the active allowlist
  under `targets/`, and there is no runtime way to disable it.
- **agents/** — the behaviors an agent can run. Shipped: `recon` (maps the target, records
  hypotheses) and `verify` (checks each hypothesis against the live target). Named but not
  yet built: `artifact-follow`.
- **evidence/** — the evidence store. Records findings as **observed** or **hypothesized**
  and keeps the two distinct; the distinction is enforced in the type, not by convention.
- **reporters/** — render the evidence store into a Markdown report and a self-contained,
  theme-aware HTML dashboard.
- **cli/** — the command-line entry point (`prism demo`, `prism run`).

## Design principles

1. **In-scope by construction.** No agent can act on a target the scope-guard has not
   cleared. Scope is data (`targets/allowlist.yaml`), not code. Enforcement is two-layer: a
   Playwright browser-context route handler runs `checkScope()` on every request the page
   makes (navigation and subresources alike, aborting anything off the allowlist), and every
   path an agent probes directly is passed through `checkScope()` before the request is
   issued. A blocked request is recorded as a scope violation in the evidence store rather
   than silently dropped.
2. **Observed vs. hypothesized.** A hypothesis is never reported as a fact. Verification is a
   first-class agent behavior whose job is to promote or discard hypotheses, and the two
   kinds live in separate sections of every report.
3. **Depth-first.** Follow a lead to its end before widening, so runs produce coherent
   findings rather than shallow breadth.

## Authorized use

Prism is a defensive and research tool for targets you own or are explicitly permitted to
test, and for intentionally vulnerable practice apps. Scope enforcement is a feature, not a
suggestion. See the README's Authorization section before you run it against anything.
