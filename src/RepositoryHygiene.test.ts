import fs from "fs";
import path from "path";

// AGENTS.md keeps pull request screenshots out of the repository and its Git LFS history: they
// belong in GitHub-hosted attachments. They have been committed and removed twice, so the check
// that CI already runs now refuses them.
test("pull request screenshots are not committed", () => {
  const screenshots = path.resolve(__dirname, "../.github/pr-screenshots");
  expect(fs.existsSync(screenshots)).toBe(false);
});
