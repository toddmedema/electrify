import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

export default class ExpectedErrorReporter implements Reporter {
  private mismatched = false;

  onTestEnd(test: TestCase, result: TestResult) {
    const expected = result.annotations.find(
      ({ type }) => type === "expected-error",
    );
    if (!expected || result.status === "skipped") return;
    if (
      result.status === "failed" &&
      result.errors.length === 1 &&
      result.errors[0].message === expected.description
    )
      return;

    this.mismatched = true;
    console.error(
      `${test.title}: expected exactly one error with this message:
${expected.description}`,
    );
  }

  async onEnd(result: FullResult) {
    if (this.mismatched && result.status === "passed")
      return { status: "failed" as const };
  }
}
