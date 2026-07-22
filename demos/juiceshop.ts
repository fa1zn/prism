/**
 * Demo: run Prism's parallel recon against a local OWASP Juice Shop instance and
 * write a findings report.
 *
 * Juice Shop is an intentionally vulnerable application built for security
 * training, so a local instance is a safe, authorized target. This demo performs
 * recon and evidence collection only — it discovers obvious artifacts (that the
 * target is Juice Shop, its public paths, its client-side JS bundle) and exploits
 * nothing.
 *
 * Prerequisites:
 *   1. Start Juice Shop:  docker run -d -p 3000:3000 bkimminich/juice-shop
 *   2. Authorize it:      cp targets/allowlist.example.yaml targets/allowlist.yaml
 *   3. Run this demo:     pnpm demo:juiceshop
 *
 * Step 2 is deliberate: Prism will not run without an allowlist you have
 * consciously created. The shipped example already authorizes localhost:3000.
 */

import { runReconAndReport } from '../src/run.js';
import { AllowlistError, initScope, ScopeViolationError } from '../src/scope/index.js';

const TARGET = 'http://localhost:3000';
const CONCURRENCY = 3;

async function main(): Promise<void> {
  // Loads targets/allowlist.yaml, prints the authorized scope, and activates it.
  // Hard-fails here if the allowlist is missing or invalid.
  const allowlist = initScope();

  process.stdout.write(`Running recon against ${TARGET} with ${CONCURRENCY} parallel agents ...\n`);
  const result = await runReconAndReport({ target: TARGET, allowlist, concurrency: CONCURRENCY });

  process.stdout.write('\n');
  process.stdout.write(
    `Done. ${result.store.count()} findings ` +
      `(${result.store.observed().length} observed, ${result.store.hypothesized().length} hypothesized).\n`,
  );
  process.stdout.write(`Markdown report: ${result.reportPath}\n`);
  process.stdout.write(`HTML dashboard:  ${result.htmlPath}\n`);
  process.stdout.write('View it with:    pnpm report:serve\n');
}

main().catch((err: unknown) => {
  if (err instanceof AllowlistError) {
    process.stderr.write(`\n[prism] Cannot start — allowlist problem:\n${err.message}\n`);
  } else if (err instanceof ScopeViolationError) {
    process.stderr.write(`\n[prism] Scope violation: ${err.message} (${err.attemptedUrl})\n`);
  } else {
    process.stderr.write(`\n[prism] Recon failed: ${(err as Error).message}\n`);
  }
  process.exitCode = 1;
});
