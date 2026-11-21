import type { PlaywrightWorkerOptions } from "@playwright/test";

// Keep the action timeline from the failing attempt even if a retry succeeds.
// Screenshots on failure remain separate. Recording the page or source on every
// action would add work to the timing-sensitive journeys we are diagnosing.
export const journeyTrace: PlaywrightWorkerOptions["trace"] = process.env.CI
  ? {
      mode: "retain-on-failure",
      screenshots: false,
      snapshots: false,
      sources: false,
      attachments: false,
    }
  : "retain-on-failure";
