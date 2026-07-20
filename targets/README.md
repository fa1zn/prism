# Targets

The **allowlist** binds a Prism run to a specific, authorized set of hosts. The scope-guard
reads it; nothing outside it is ever touched. Prism loads `targets/allowlist.yaml` and
refuses to run without it.

## Getting started

Copy the example and edit it for your scope:

```bash
cp targets/allowlist.example.yaml targets/allowlist.yaml
```

Your real `allowlist.yaml` is git-ignored. Only `allowlist.example.yaml` is tracked.

## Rules

- Only add a host you **own** or have **explicit written permission** to test.
- Intentionally vulnerable practice apps (e.g. a local OWASP Juice Shop) are fair game.
- Every entry needs an `authorization` field, in your own words, stating why testing it is
  in bounds. Prism refuses to start if any entry is missing one.

## Format

```yaml
operator: Your Name
targets:
  - host: localhost:3000 # exact host[:port] or a wildcard like *.example.test
    authorization: 'OWASP Juice Shop running locally on my own machine.'
    added_at: 2026-07-20
```

The example targets a **local** Juice Shop at `http://localhost:3000`. Stand one up with:

```bash
docker run --rm -p 3000:3000 bkimminich/juice-shop
```
