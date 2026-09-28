import fs from "fs";
import path from "path";

// AGENTS.md keeps pull request screenshots out of the repository and its Git LFS history: they
// belong in GitHub-hosted attachments. They have been committed and removed twice, so the check
// that CI already runs now refuses them.
test("pull request screenshots are not committed", () => {
  const screenshots = path.resolve(__dirname, "../.github/pr-screenshots");
  expect(fs.existsSync(screenshots)).toBe(false);
});

// app.scss has one corner scale (--radius-sm/md/lg/pill in :root). A raw pixel radius anywhere
// else is how the sheet drifted to twelve different corners, so only the tokens may set one.
test("app.scss sets corner radii only through the radius tokens", () => {
  const sheet = fs.readFileSync(path.resolve(__dirname, "app.scss"), "utf8");
  const raw = sheet
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(
      ({ line }) =>
        /^border(-[a-z-]+)?-radius\s*:/.test(line) &&
        /\b[1-9]\d*px\b/.test(line),
    )
    .map(({ line, number }) => `${number}: ${line}`);
  expect(raw).toEqual([]);
});
