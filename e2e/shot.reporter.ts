import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * Prints only what `npm run shot` promises: the file lines the test writes to stdout, and a
 * short failure message. Playwright's own progress lines would add output the caller must read.
 */
export default class ShotReporter implements Reporter {
  printsToStdio() {
    return true;
  }

  onStdOut(chunk: string | Buffer) {
    process.stdout.write(chunk);
  }

  onStdErr(chunk: string | Buffer) {
    process.stderr.write(chunk);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === "passed") return;
    const project = test.parent.project()?.name ?? "shot";
    const message = (result.error?.message ?? result.status)
      .replace(ANSI, "")
      .split("\n")
      .filter((line) => line.trim())
      .slice(0, 8)
      .join("\n  ");
    console.error(`shot failed [${project}]: ${message}`);
  }

  onError(error: { message?: string }) {
    console.error(`shot error: ${(error.message ?? "").replace(ANSI, "")}`);
  }

  onEnd(result: FullResult) {
    if (result.status !== "passed")
      console.error(
        `shot: ${result.status}; nothing is written for failed projects`,
      );
  }
}
