#!/usr/bin/env node
// Offline verification runner for the PostHog product-analytics integration.
//
//   node posthog-analytics.verify.mjs
//
// Runs the real handler tests (posthog-analytics.test.mjs) with the toolchain
// this project already has (node --test), in a clean child environment: no
// dotenv, no framework autoload, synthetic configuration only, no network.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const TEST_FILE = join(ROOT, "posthog-analytics.test.mjs");
const NODE_BIN = process.execPath;
const TIMEOUT_MS = 120_000;
const MIN_PASSING_TESTS = 12;

// Synthetic configuration. Deliberately not a PostHog token: the offline run
// never talks to PostHog, so no phc_/phx_ value is needed or accepted.
const SYNTHETIC_TOKEN = "test-project-token-synthetic";
const SYNTHETIC_HOST = "https://us.i.posthog.com";

function stop(message) {
  console.error(`posthog-analytics.verify: ${message}`);
  process.exit(1);
}

if (!existsSync(NODE_BIN)) stop("node runtime not found");
if (!existsSync(TEST_FILE)) stop("missing test file: posthog-analytics.test.mjs");
if (!existsSync(join(ROOT, "src/lib/analytics.ts"))) stop("missing instrumented handlers: src/lib/analytics.ts");

// Child env starts empty: OS/path/temp values plus fixed synthetic config.
// DOTENV_CONFIG_* / .env autoload is never passed through.
const childEnv = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  TMPDIR: process.env.TMPDIR ?? process.env.TMP ?? process.env.TEMP ?? "",
  TEMP: process.env.TEMP ?? "",
  TMP: process.env.TMP ?? "",
  SystemRoot: process.env.SystemRoot ?? "",
  windir: process.env.windir ?? "",
  NODE_ENV: "test",
  NO_COLOR: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: SYNTHETIC_TOKEN,
  NEXT_PUBLIC_POSTHOG_HOST: SYNTHETIC_HOST,
};

const run = spawnSync(
  NODE_BIN,
  ["--test", "--test-reporter=tap", TEST_FILE],
  {
    cwd: ROOT,
    env: childEnv,
    shell: false,
    timeout: TIMEOUT_MS,
    encoding: "utf8",
    windowsHide: true,
  },
);

if (run.error) stop(`could not run the test runner: ${run.error.message}`);
if (run.stdout) process.stdout.write(run.stdout);
if (run.stderr) process.stderr.write(run.stderr);

const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;

if (run.status !== 0) stop(`tests failed (exit status ${run.status})`);

const passed = Number(/# pass (\d+)/.exec(output)?.[1] ?? 0);
const failed = Number(/# fail (\d+)/.exec(output)?.[1] ?? 0);

if (!Number.isFinite(passed) || passed === 0) stop("zero assertions ran — the suite did not execute");
if (failed > 0) stop(`${failed} test(s) failed`);
if (passed < MIN_PASSING_TESTS) stop(`only ${passed} test(s) passed, expected at least ${MIN_PASSING_TESTS}`);

console.log(
  `posthog-analytics.verify: OK — ${passed} offline test(s) passed against the real handlers, no network, synthetic token only.`,
);
