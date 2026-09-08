#!/usr/bin/env node
/**
 * PM2 Manager Dashboard - Unified E2E Test Runner
 * Executes Tier 1 (Features), Tier 2 (Boundaries), Tier 3 (Combinations),
 * and Tier 4 (Workloads) against the live running server.
 *
 * Usage:
 *   npx tsx tests/e2e/runner.ts [options]
 *   node --experimental-strip-types tests/e2e/runner.ts [options]
 *
 * Options:
 *   --url=<url>        Target server URL (default: http://localhost:3000)
 *   --tier=<1|2|3|4|all> Run specific tier or all (default: all)
 *   --bail             Stop execution on first failed test
 *   --verbose, -v      Print individual test names as they run
 *   --wait=<seconds>   Wait up to N seconds for server to become reachable
 *   --help, -h         Show help message
 */

import { TestClient } from './client';
import { TestSuiteCollector } from './test-framework';
import { registerTier1Tests } from './tier1-features.test';
import { registerTier2Tests } from './tier2-boundaries.test';
import { registerTier3Tests } from './tier3-combinations.test';
import { registerTier4Tests } from './tier4-workloads.test';
import { MockE2EServer } from './mock-server';

interface CliOptions {
  url: string;
  tier: '1' | '2' | '3' | '4' | 'all';
  bail: boolean;
  verbose: boolean;
  wait: number;
  help: boolean;
  list: boolean;
  selfTest: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    url: process.env.TEST_SERVER_URL || process.env.BASE_URL || 'http://localhost:3000',
    tier: 'all',
    bail: false,
    verbose: true,
    wait: 0,
    help: false,
    list: false,
    selfTest: false,
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--self-test') {
      options.selfTest = true;
    } else if (arg === '--list' || arg === '--dry-run') {
      options.list = true;
    } else if (arg.startsWith('--url=')) {
      options.url = arg.substring(6).trim();
    } else if (arg.startsWith('--tier=')) {
      const t = arg.substring(7).trim().toLowerCase();
      if (['1', '2', '3', '4', 'all'].includes(t)) {
        options.tier = t as any;
      }
    } else if (arg === '--bail') {
      options.bail = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--quiet' || arg === '-q') {
      options.verbose = false;
    } else if (arg.startsWith('--wait=')) {
      options.wait = parseInt(arg.substring(7).trim(), 10) || 0;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
PM2 Manager Dashboard - Unified E2E Test Runner

Usage:
  npx tsx tests/e2e/runner.ts [options]

Options:
  --url=<url>         Target server base URL (default: http://localhost:3000)
  --tier=<1|2|3|4|all> Select tier to run (default: all)
  --bail              Exit immediately on first test failure
  --verbose, -v       Detailed logging of test execution
  --quiet, -q         Minimal summary only
  --wait=<seconds>    Wait up to N seconds for server to be reachable
  --help, -h          Show this message
`);
}

async function checkServerReachable(url: string, waitSec = 0): Promise<boolean> {
  const startTime = Date.now();
  const maxTime = startTime + waitSec * 1000;

  do {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(url, { signal: controller.signal, redirect: 'manual' });
      clearTimeout(timeoutId);
      if (res.status > 0) return true;
    } catch {
      // Server not up yet
    }
    if (Date.now() < maxTime) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  } while (Date.now() < maxTime);

  return false;
}

export async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  console.log('\x1b[1m\x1b[36m=================================================================\x1b[0m');
  console.log('\x1b[1m\x1b[36m         PM2 Manager Dashboard - E2E Verification Suite          \x1b[0m');
  console.log('\x1b[1m\x1b[36m=================================================================\x1b[0m');
  console.log(`Target URL : \x1b[33m${options.url}\x1b[0m`);
  console.log(`Target Tier: \x1b[33m${options.tier.toUpperCase()}\x1b[0m`);
  console.log(`Bail on err: \x1b[33m${options.bail}\x1b[0m\n`);

  // If --list or --dry-run, register tests and print inventory without connecting
  if (options.list) {
    const client = new TestClient(options.url);
    const credentials = {
      username: process.env.TEST_ADMIN_USER || 'admin',
      password: process.env.TEST_ADMIN_PASS || 'password123',
    };
    const collector = new TestSuiteCollector();

    if (options.tier === '1' || options.tier === 'all') {
      registerTier1Tests(collector, client, credentials);
    }
    if (options.tier === '2' || options.tier === 'all') {
      registerTier2Tests(collector, client, credentials);
    }
    if (options.tier === '3' || options.tier === 'all') {
      registerTier3Tests(collector, client, credentials);
    }
    if (options.tier === '4' || options.tier === 'all') {
      registerTier4Tests(collector, client, credentials);
    }

    const cases = collector.getCases();
    console.log(`\x1b[1m\x1b[32mDiscovered ${cases.length} test cases:\x1b[0m\n`);
    let currentSuite = '';
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      if (c.suite !== currentSuite) {
        currentSuite = c.suite;
        console.log(`\x1b[1m\x1b[33m[${currentSuite}]\x1b[0m`);
      }
      console.log(`  ${i + 1}. ${c.name}`);
    }
    console.log(`\n\x1b[1mTotal Registered Test Cases: ${cases.length}\x1b[0m\n`);
    process.exit(0);
  }

  let mockServer: MockE2EServer | null = null;
  if (options.selfTest) {
    mockServer = new MockE2EServer();
    const port = await mockServer.start(0);
    options.url = `http://127.0.0.1:${port}`;
    console.log(`\x1b[35m[SELF-TEST MODE]\x1b[0m In-process spec server started on \x1b[33m${options.url}\x1b[0m`);
  } else {
    // Check server connectivity
    process.stdout.write(`Connecting to ${options.url}... `);
    const isOnline = await checkServerReachable(options.url, options.wait);
    if (!isOnline) {
      console.log('\x1b[31mOFFLINE\x1b[0m\n');
      console.error(`\x1b[31mError: Target server at ${options.url} is not reachable.\x1b[0m`);
      console.error('Please ensure the application is started before executing E2E tests:');
      console.error('  npm run dev (or npm run start)\n');
      console.error('To verify test suite and assertions using in-process reference server:');
      console.error('  npx tsx tests/e2e/runner.ts --self-test\n');
      process.exit(1);
    }
    console.log('\x1b[32mCONNECTED\x1b[0m\n');
  }

  const client = new TestClient(options.url);
  const credentials = {
    username: process.env.TEST_ADMIN_USER || 'admin',
    password: process.env.TEST_ADMIN_PASS || 'password123',
  };

  const collector = new TestSuiteCollector();

  // Register requested tiers
  if (options.tier === '1' || options.tier === 'all') {
    registerTier1Tests(collector, client, credentials);
  }
  if (options.tier === '2' || options.tier === 'all') {
    registerTier2Tests(collector, client);
  }
  if (options.tier === '3' || options.tier === 'all') {
    registerTier3Tests(collector, client, credentials);
  }
  if (options.tier === '4' || options.tier === 'all') {
    registerTier4Tests(collector, client, credentials);
  }

  const allCases = collector.getCases();
  console.log(`Discovered \x1b[1m${allCases.length}\x1b[0m test cases to execute.\n`);

  const summary = await collector.runAll({
    bail: options.bail,
    verbose: options.verbose,
  });

  // Calculate total assertions
  let totalAssertions = 0;
  for (const r of summary.results) {
    totalAssertions += r.assertionCount;
  }

  console.log('\n\x1b[1m\x1b[36m=================================================================\x1b[0m');
  console.log('\x1b[1m\x1b[36m                       TEST RUN SUMMARY                          \x1b[0m');
  console.log('\x1b[1m\x1b[36m=================================================================\x1b[0m');
  console.log(`Total Test Cases : \x1b[1m${summary.total}\x1b[0m`);
  console.log(`Total Assertions : \x1b[1m${totalAssertions}\x1b[0m`);
  console.log(`Passed           : \x1b[32m${summary.passed}\x1b[0m`);
  console.log(`Failed           : \x1b[31m${summary.failed}\x1b[0m`);
  console.log(`Total Duration   : \x1b[33m${(summary.durationMs / 1000).toFixed(2)}s\x1b[0m`);

  if (mockServer) {
    await mockServer.stop();
  }

  if (summary.failed > 0) {
    console.log('\n\x1b[1m\x1b[31mFAILED TESTS:\x1b[0m');
    for (const r of summary.results) {
      if (!r.passed) {
        console.log(`  \x1b[31m✖ [${r.suite}] ${r.name}\x1b[0m`);
        if (r.error) {
          console.log(`    ${r.error.split('\n')[0]}`);
        }
      }
    }
    console.log('\n\x1b[1m\x1b[31mOVERALL STATUS: FAILED\x1b[0m\n');
    process.exit(1);
  } else {
    console.log('\n\x1b[1m\x1b[32mOVERALL STATUS: ALL TESTS PASSED (100% SUCCESS)\x1b[0m\n');
    process.exit(0);
  }
}

if (process.argv[1]?.endsWith('runner.ts') || process.argv[1]?.endsWith('runner.js')) {
  main().catch((err) => {
    console.error('Fatal Runner Error:', err);
    process.exit(1);
  });
}
