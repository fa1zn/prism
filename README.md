# Prism

Prism is a command-line tool for automated security recon on a web app. You give it a target
you are allowed to test and an allowlist. It runs headless-browser agents that crawl the app,
enumerate paths and forms, verify what they find, and write a report.

Requests are checked against the allowlist. A host that is not on the list is never contacted,
and there is no flag or environment variable to disable that.

Findings are labeled observed or hypothesized. Observed means an agent saw it. Hypothesized
means it was inferred (for example, a path named in robots.txt) and not yet checked. A verify
pass confirms or refutes each hypothesis.

Each run writes a Markdown report and an HTML report to `reports/`. Prism does recon and
verification. It does not exploit anything.

## What it does

- Loads the app, reads the accessibility tree, and detects the framework and version.
- Enumerates links, forms (fields and methods), and well-known paths.
- Reads robots.txt and sitemap.xml and verifies anything named there.
- Fetches same-origin script bundles.
- Runs several agents in parallel, each in its own browser context.
- Verifies each lead with a single GET: confirmed, refuted, access-controlled, or client-side route.

## Example

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

Prism is only for testing systems you own or have explicit written permission to test.

For practice, self-host a deliberately vulnerable application:

- [OWASP Juice Shop](https://owasp.org/www-project-juice-shop/)
- [DVWA](https://github.com/digininja/DVWA)
- [WebGoat](https://owasp.org/www-project-webgoat/)
- [PortSwigger Web Security Academy](https://portswigger.net/web-security) labs

Unauthorized testing of systems you do not own is illegal in most jurisdictions (the Computer
Fraud and Abuse Act in the US, the Computer Misuse Act in the UK, and equivalents elsewhere).
The allowlist is a safeguard against mistakes, not a substitute for permission.

## Quickstart

```bash
# Clone and install
git clone https://github.com/fa1zn/prism.git
cd prism
pnpm install

# Start a local, authorized target (OWASP Juice Shop)
docker run -d -p 3000:3000 bkimminich/juice-shop

# Create your allowlist. Prism will not run without one.
# The example already authorizes localhost:3000.
cp targets/allowlist.example.yaml targets/allowlist.yaml

# Run the demo, then open the report
pnpm demo:juiceshop
pnpm report:serve                      # serves reports/ at http://localhost:4173
```

Your real `targets/allowlist.yaml` is git-ignored; only the example is tracked.

## Usage

```bash
prism demo juiceshop                          # bundled demo
prism run --target http://localhost:3000      # any allowlisted target
prism run --target <url> --concurrency 5      # 1..10 parallel agents (default 3)
prism run --target <url> --no-verify          # recon only, skip verification
```

`run` refuses any target that is not on the allowlist before it opens a browser.

## License

[MIT](./LICENSE). Uses [Playwright](https://playwright.dev/).
