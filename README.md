# Prism

Prism is a command-line security testing tool for web applications. You point it at a target
you are authorized to test, and it runs a set of headless-browser agents that map the app,
enumerate paths and forms, verify what they find, and write a report.

- Requests are restricted to an allowlist you define. Anything not on the allowlist is
  blocked before it is sent, and there is no flag or environment variable to disable this.
- Findings are labeled either observed (seen directly during the run) or hypothesized (inferred
  and not yet checked). A verify step checks each hypothesis against the target and marks it
  confirmed or refuted.
- Each run writes a Markdown report and a self-contained HTML report to `reports/`.

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
