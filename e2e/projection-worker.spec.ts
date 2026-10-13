import { expect, test } from "./fixtures";
import { openPane, waitForSettled } from "./layout";

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
      held: false,
    };
    Object.assign(window, { projectionWorkerTest: state });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event) => {
          if (event.data.transport) {
            // Hold the refreshed reply before the application receives it. This lets the
            // month-driven viewport settle independently of forecast publication.
            if (state.completed === 1 && !state.held) {
              state.held = true;
              event.stopImmediatePropagation();
              Object.assign(window, {
                releaseProjectionReply: () =>
                  this.dispatchEvent(
                    new MessageEvent("message", { data: event.data }),
                  ),
              });
              return;
            }
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
  await openPane(
    page.locator(".insights"),
    page.getByRole("button", { name: "Insights", exact: true }),
  );
  await waitForSettled(page, "#appbar");
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
              held: boolean;
            };
          }
        ).projectionWorkerTest,
    );
  await expect
    .poll(async () => (await workerState()).completed, { timeout: 60_000 })
    .toBeGreaterThanOrEqual(1);
  const chart = page
    .locator(".insights:visible")
    .getByRole("img", { name: /^Chart of / })
    .first();
  // Receiving transferred buffers precedes their chunked reconstruction and publication.
  // Observe the actual forecast UI, so an undelivered or unadopted reply cannot pass.
  await expect(chart).toBeVisible({ timeout: 60_000 });
  expect(await chart.getAttribute("aria-label")).toBeTruthy();
  await page
    .locator("#appbar:visible")
    .getByRole("button", { name: "fast speed", exact: true })
    .click();
  await expect
    .poll(async () => (await workerState()).held, { timeout: 60_000 })
    .toBe(true);
  await page
    .locator("#appbar:visible")
    .first()
    .getByRole("button", { name: "pause", exact: true })
    .click();
  await waitForSettled(page, "#appbar");
  const heldSummary = await chart.getAttribute("aria-label");
  expect(heldSummary).toBeTruthy();
  expect((await workerState()).requested).toBe(2);
  expect((await workerState()).completed).toBe(1);
  await page.evaluate(() =>
    (
      window as unknown as { releaseProjectionReply: () => void }
    ).releaseProjectionReply(),
  );
  // Game time and the viewport are fixed now: this change must follow the released decode.
  await expect(chart).not.toHaveAttribute("aria-label", heldSummary!, {
    timeout: 60_000,
  });
  const result = await workerState();
  expect(result.errors).toBe(0);
  expect(result.framesWhilePending).toBeGreaterThan(0);
  await testInfo.attach("worker-responsiveness.json", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
});
