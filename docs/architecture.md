# Architecture

> Scaffold-stage notes. Everything below describes intent, not shipped behavior.

## Overview

Prism runs a pool of parallel headless-browser agents (via Playwright) that explore an
authorized web target with **depth-first discipline** — chasing one promising lead to its
conclusion before fanning out — and record what they find as structured evidence.

## Components

- **core/** — the orchestrator and task queue. Owns the agent pool, dispatches tasks,
  and enforces exploration order and run limits.
- **scope/** — the scope-guard. A single chokepoint every agent action passes through;
  denies anything outside the active allowlist under `targets/`.
- **agents/** — the behaviors an agent can run: `recon`, `artifact-follow`, `verify`.
- **evidence/** — the evidence store. Records findings as **observed** or
  **hypothesized** and keeps the two distinct.
- **reporters/** — renders the evidence store into a Markdown report.
- **cli/** — the command-line entry point.

## Design principles

1. **In-scope by construction.** No agent can act on a target the scope-guard has not
   cleared. Scope is data (`targets/allowlist.yaml`), not code. The recon agent enforces
   this two ways: a Playwright browser-context route handler runs `checkScope()` on every
   request the page makes (navigation and subresources alike, aborting anything off the
   allowlist), and every path the agent probes directly is passed through `checkScope()`
   before the request is issued.
2. **Observed vs. hypothesized.** A hypothesis is never reported as a fact. Verification
   is a first-class agent behavior whose job is to promote or discard hypotheses.
3. **Depth-first.** Follow a lead to its end before widening, so runs produce coherent
   findings rather than shallow breadth.

## Authorized use

Prism is a defensive and research tool for targets you own or are explicitly permitted to
test, and for intentionally vulnerable practice apps. Scope enforcement is a feature, not
a suggestion.
