# Prism

Prism is a command-line tool that does automated security recon on a web app. You give it a
target you are allowed to test and an allowlist. It runs a few headless-browser agents that
crawl the app, read the DOM and the network traffic, enumerate paths and forms, and chase
whatever looks worth chasing. Then it writes up what it found.

The idea is depth over breadth. A lot of scanners touch a thousand things and tell you
nothing. Prism follows fewer leads all the way down, so you end up with a picture of the app
instead of a checklist.

Two rules it does not break.

**It stays in scope.** Every request goes through one check against your allowlist. If a host
is not on the list, the request is not sent. There is no flag or environment variable to turn
that off. When the browser tries to reach something off-list on its own (a tracker, a CDN, an
outbound call), Prism kills the request and writes it down.

**It does not guess out loud.** Everything it records is tagged observed or hypothesized.
Observed means an agent saw it. Hypothesized means an agent inferred it, like a path named in
robots.txt, and has not checked yet. A second pass takes each hypothesis and confirms or kills
it. The report keeps the two apart, so you never read a hunch as a fact.

Each run writes two files: a Markdown report and a self-contained HTML page.

## What it does

- Loads the app, reads the accessibility tree, and pulls the framework and version off the page.
- Enumerates links, forms (fields and methods), and well-known paths.
- Reads robots.txt and sitemap.xml and treats anything named there as a lead to verify.
- Fetches same-origin script bundles and notes what they are.
- Runs several agents in parallel, each in its own browser context, pulling work off a shared
  queue. Finding one thing can queue up the next.
- Verifies each lead with a single GET: confirmed, refuted, access-controlled, or a client-side
  route that an HTTP GET cannot resolve.

It does recon and verification. It does not exploit anything, and a run sends no attack traffic.

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
