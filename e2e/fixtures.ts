import { Page, Request, test as base } from "@playwright/test";

export * from "@playwright/test";

const readBrowserEnvironment = () => ({
  pathname: window.location.pathname,
  online: navigator.onLine,
  touchPoints: navigator.maxTouchPoints,
  coarsePointer: matchMedia("(pointer: coarse)").matches,
  coarsePointerAvailable: matchMedia("(any-pointer: coarse)").matches,
  hover: matchMedia("(hover: hover)").matches,
  viewport: { width: innerWidth, height: innerHeight },
});

export const test = base.extend<{
  showCloudSaveInvitation: boolean;
  cloudSaveInvitationSetup: void;
  networkDiagnostics: void;
}>({
  showCloudSaveInvitation: [false, { option: true }],
  networkDiagnostics: [
    async ({ context, baseURL }, use, info) => {
      const failures: string[] = [];
      const navigationStates: ReturnType<typeof readBrowserEnvironment>[] = [];
      const pageListeners = new Map<Page, () => void>();
      const recordPage = (page: Page) => {
        const recordNavigation = () => {
          void page.evaluate(readBrowserEnvironment).then(
            (state) => navigationStates.push(state),
            () => {},
          );
        };
        page.on("domcontentloaded", recordNavigation);
        pageListeners.set(page, recordNavigation);
      };
      context.on("page", recordPage);
      context.pages().forEach(recordPage);
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
      context.off("page", recordPage);
      pageListeners.forEach((listener, page) =>
        page.off("domcontentloaded", listener),
      );
      if (info.status !== info.expectedStatus) {
        if (failures.length) {
          const evidence = [...new Set(failures)].join("\n");
          console.error(evidence);
          await info.attach("network-failures", {
            body: evidence,
            contentType: "text/plain",
          });
        }
        const environment = await Promise.all(
          context.pages().map(async (page) => {
            try {
              return await page.evaluate(readBrowserEnvironment);
            } catch {
              return { closed: true };
            }
          }),
        );
        await info.attach("browser-environment", {
          body: JSON.stringify(
            {
              declaredHasTouch: !!info.project.use.hasTouch,
              navigationStates,
              pages: environment,
            },
            null,
            2,
          ),
          contentType: "application/json",
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
