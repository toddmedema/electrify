import { BrowserContext, Request, test as base } from "@playwright/test";

export * from "@playwright/test";

/** Tests must never report usage to the production Analytics stream. Page routes can supply
 * a local Google tag stub when a spec needs observable analytics behavior. */
export async function isolateAnalytics(context: BrowserContext): Promise<void> {
  await context.route(
    /^https:\/\/(?:[^/]+\.)?(?:googletagmanager|google-analytics)\.com\//,
    (route) => route.abort(),
  );
}

export const test = base.extend<{
  showCloudSaveInvitation: boolean;
  cloudSaveInvitationSetup: void;
  networkDiagnostics: void;
  analyticsIsolation: void;
}>({
  showCloudSaveInvitation: [false, { option: true }],
  analyticsIsolation: [
    async ({ context }, use) => {
      await isolateAnalytics(context);
      await use();
    },
    { auto: true },
  ],
  networkDiagnostics: [
    async ({ context, baseURL }, use, info) => {
      const failures: string[] = [];
      const record = (request: Request) => {
        const url = new URL(request.url());
        const error = request.failure()?.errorText;
        // Aborted requests are normal during navigation; deliberate offline/error
        // tests also keep their expected status. Print transport evidence only on failure.
        if (
          baseURL &&
          url.origin === new URL(baseURL).origin &&
          error &&
          error !== "net::ERR_ABORTED"
        )
          failures.push(
            `Network failure: ${request.method()} ${url.pathname} (${request.resourceType()}): ${error}`,
          );
      };
      context.on("requestfailed", record);
      await use();
      context.off("requestfailed", record);
      if (info.status !== info.expectedStatus && failures.length) {
        const evidence = [...new Set(failures)].join("\n");
        console.error(evidence);
        await info.attach("network-failures", {
          body: evidence,
          contentType: "text/plain",
        });
      }
    },
    { auto: true },
  ],
  cloudSaveInvitationSetup: [
    async ({ context, showCloudSaveInvitation }, use) => {
      if (!showCloudSaveInvitation) {
        await context.addInitScript(() => {
          let deviceStorage: Storage;
          try {
            deviceStorage = window.localStorage;
          } catch {
            return;
          }
          const markSeen = () => {
            try {
              deviceStorage.setItem("electrify-cloud-save-prompt-seen", "true");
            } catch {
              // Storage-failure tests must still exercise the unavailable storage.
            }
          };
          const clear = Storage.prototype.clear;
          Storage.prototype.clear = function () {
            clear.call(this);
            if (this === deviceStorage) markSeen();
          };
          // Specs reset preferences in their own init scripts. Preserve only this
          // unrelated invitation marker, regardless of init-script execution order.
          markSeen();
        });
      }
      await use();
    },
    { auto: true },
  ],
});
