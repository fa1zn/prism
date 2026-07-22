#!/usr/bin/env node

/**
 * Prism CLI.
 *
 * Commands:
 *   prism demo juiceshop            Run the bundled Juice Shop recon demo (localhost:3000).
 *   prism run --target <url>        Run recon against a target that is on the allowlist.
 *
 * Scope is never optional: `run` initializes the allowlist and refuses any target
 * not on it. There is no flag to disable that.
 */

import { runReconAndReport } from '../run.js';
import { AllowlistError, initScope, isInScope, ScopeViolationError } from '../scope/index.js';
import { DEFAULT_CONCURRENCY } from '../core/orchestrator.js';

const BANNER = 'prism: authorized-scope security research agent';

function printUsage(out: NodeJS.WritableStream = process.stdout): void {
  out.write(`${BANNER}\n\n`);
  out.write('Usage:\n');
  out.write(
    '  prism demo juiceshop              Run the Juice Shop recon demo (http://localhost:3000)\n',
  );
  out.write('  prism run --target <url>          Run recon against an allowlisted target\n');
  out.write('                 [--concurrency N]  Parallel agents (default 3, max 10)\n');
  out.write('                 [--no-verify]      Skip the verify phase (recon only)\n');
  out.write('\n');
  out.write('A target passed to `run` must appear in targets/allowlist.yaml.\n');
}

/** Minimal flag parser for `--key value` and `--key=value`. */
function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined || !arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[arg.slice(2)] = next;
        i += 1;
      } else {
        flags[arg.slice(2)] = 'true';
      }
    }
  }
  return flags;
}

async function runReport(target: string, concurrency: number, verify: boolean): Promise<void> {
  // Initialize scope first: prints the authorized allowlist and activates it.
  const allowlist = initScope();

  // The target must be on the allowlist before we do anything else.
  if (!isInScope(allowlist, target)) {
    process.stderr.write(
      `\n[prism] Target ${target} is not on the allowlist. ` +
        'Add it to targets/allowlist.yaml (with an authorization note) first. Refusing to run.\n',
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Running recon${verify ? ' + verify' : ''} against ${target} with up to ${concurrency} parallel agents ...\n`,
  );
  const result = await runReconAndReport({ target, allowlist, concurrency, verify });

  process.stdout.write('\n');
  process.stdout.write(
    `Done. ${result.store.count()} findings ` +
      `(${result.store.observed().length} observed, ${result.store.hypothesized().length} hypothesized).\n`,
  );
  process.stdout.write(`Markdown report: ${result.reportPath}\n`);
  process.stdout.write(`HTML dashboard:  ${result.htmlPath}\n`);
  process.stdout.write('View it with:    pnpm report:serve\n');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [command, subcommand] = argv;

  if (command === undefined) {
    printUsage();
    return;
  }

  if (command === 'demo' && subcommand === 'juiceshop') {
    await runReport('http://localhost:3000', DEFAULT_CONCURRENCY, true);
    return;
  }

  if (command === 'run') {
    const flags = parseFlags(argv.slice(1));
    const target = flags['target'];
    if (target === undefined || target === 'true') {
      process.stderr.write('[prism] `run` requires --target <url>.\n\n');
      printUsage(process.stderr);
      process.exitCode = 1;
      return;
    }
    const concurrency =
      flags['concurrency'] !== undefined ? Number(flags['concurrency']) : DEFAULT_CONCURRENCY;
    const verify = flags['no-verify'] !== 'true';
    await runReport(
      target,
      Number.isFinite(concurrency) ? concurrency : DEFAULT_CONCURRENCY,
      verify,
    );
    return;
  }

  process.stderr.write(`[prism] Unknown command: ${argv.join(' ')}\n\n`);
  printUsage(process.stderr);
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  if (err instanceof AllowlistError) {
    process.stderr.write(`\n[prism] Cannot start — allowlist problem:\n${err.message}\n`);
  } else if (err instanceof ScopeViolationError) {
    process.stderr.write(`\n[prism] Scope violation: ${err.message} (${err.attemptedUrl})\n`);
  } else {
    process.stderr.write(`\n[prism] Failed: ${(err as Error).message}\n`);
  }
  process.exitCode = 1;
});
