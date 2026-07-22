# Prism

**An AI security testing tool. Point it at a web app you're allowed to test, get back a scoped, evidence-graded report.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

Prism runs a pool of AI-driven headless-browser agents over a single authorized target. It
maps the app, enumerates paths and forms, follows leads, verifies what it finds, and hands
you two artifacts: a Markdown report and a self-contained HTML dashboard.

- **You get a report, not a wall of noise.** Every finding is graded, either something an
  agent directly observed or a hypothesis it hasn't verified yet, and the two are never mixed.
  A verify pass checks each hypothesis against the live target and marks it confirmed or refuted.
- **It cannot go out of scope.** Every request is checked against an allowlist you write by
  hand, at a single chokepoint, with no runtime way to turn it off. No `--force`, no env var,
  no flag. A host you didn't authorize is a host Prism won't touch, and any attempt to reach
  one is aborted and logged.
- **One command, two outputs.** A Markdown report and a theme-aware HTML dashboard, both
  self-contained, that open or serve anywhere.

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

## Authorization

**Prism is only for testing systems you own or have explicit written permission to test.**

If you want a safe target to run it against, self-host a deliberately vulnerable practice
application:

- [OWASP Juice Shop](https://owasp.org/www-project-juice-shop/)
- [DVWA](https://github.com/digininja/DVWA)
- [WebGoat](https://owasp.org/www-project-webgoat/)
- [PortSwigger Web Security Academy](https://portswigger.net/web-security) labs

All of these are meant to be attacked and are the right way to learn on your own machine.

Unauthorized testing of systems you do not own is illegal in most jurisdictions (the
Computer Fraud and Abuse Act in the US, the Computer Misuse Act in the UK, and equivalents
elsewhere). Prism's scope-guard is a safeguard against mistakes, not a substitute for
permission. Staying in scope is your job. New to this? Start at [disclose.io](https://disclose.io/).

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

Your real `targets/allowlist.yaml` is git-ignored; only the example is tracked.

Drive it directly:

```bash
prism demo juiceshop                          # the bundled demo
prism run --target http://localhost:3000      # any allowlisted target
prism run --target <url> --concurrency 5      # 1..10 parallel agents (default 3)
```

`run` refuses any `--target` that is not on the allowlist, before it opens a browser.

## License

[MIT](./LICENSE). Built on [Playwright](https://playwright.dev/); practice against
[OWASP Juice Shop](https://owasp.org/www-project-juice-shop/).
