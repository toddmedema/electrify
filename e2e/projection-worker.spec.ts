import { expect, test } from "./fixtures";

test("month rollover forecasts finish in a worker while the UI keeps painting", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("audioEnabled", "false");
    const state = {
      requested: 0,
      completed: 0,
      errors: 0,
      framesWhilePending: 0,
      pending: 0,
    };
    Object.assign(window, { projectionWorkerTest: state });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event) => {
          if (event.data.projection) {
            state.completed++;
            state.pending--;
          } else if (event.data.error) {
            state.errors++;
          }
        });
        this.addEventListener("error", () => state.errors++);
      }
      postMessage(message: unknown) {
        if (
          message &&
          typeof message === "object" &&
          "game" in message &&
          "now" in message
        ) {
          state.requested++;
          state.pending++;
        }
        super.postMessage(message);
      }
    };
    const frame = () => {
      if (state.pending) state.framesWhilePending++;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.goto("/?scenario=103");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page
    .locator("#appbar:visible")
    .first()
    .getByRole("button", { name: "fast speed", exact: true })
    .click();
  const workerState = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            projectionWorkerTest: {
              requested: number;
              completed: number;
              errors: number;
              framesWhilePending: number;
            };
          }
        ).projectionWorkerTest,
    );
  await expect
    .poll(async () => (await workerState()).completed, { timeout: 60_000 })
    .toBeGreaterThanOrEqual(2);
  await page
    .locator("#appbar:visible")
    .first()
    .getByRole("button", { name: "pause", exact: true })
    .click();
  const result = await workerState();
  expect(result.errors).toBe(0);
  expect(result.framesWhilePending).toBeGreaterThan(0);
  await testInfo.attach("worker-responsiveness.json", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
});
