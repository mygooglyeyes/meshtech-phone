/**
 * Minimal zero-dependency test runner.
 *
 * No npm/node toolchain is installed on this machine (checked); Deno's
 * node-compat binary runs TS directly, so tests stay dependency-free
 * and still pin the golden vectors. Swap for vitest later if a
 * toolchain lands.
 *
 * Async tests (2026-09-23): a test fn may return a promise (or use
 * async/await) - the runner awaits it before judging the result.
 * Needed by the directclient reconnect test, whose retry timer fires
 * ~1s after a simulated drop.
 */

interface TestResult {
  name: string;
  ok: boolean;
  error?: unknown;
}

const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];
const results: TestResult[] = [];

export function test(name: string, fn: () => void | Promise<void>): void {
  tests.push({ name, fn });
}

let ran = false;

export function runIfMain(): void {
  if (ran) return;
  ran = true;
  // Defer to the next macrotask so every module's test() registrations
  // (imports run first) are collected before execution.
  setTimeout(execute, 0);
}

async function execute(): Promise<void> {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`ok   ${name}`);
    } catch (error) {
      results.push({ name, ok: false, error });
      console.log(`FAIL ${name}`);
      console.log(String((error as Error)?.stack || error));
      failed++;
    }
  }
  console.log(`
${results.length - failed} passed, ${failed} failed`);
  if (failed > 0) Deno.exit(1);
}
