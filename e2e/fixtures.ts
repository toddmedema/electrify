import { test as base } from "@playwright/test";

export * from "@playwright/test";

export const test = base.extend<{
  showCloudSaveInvitation: boolean;
  cloudSaveInvitationSetup: void;
}>({
  showCloudSaveInvitation: [false, { option: true }],
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
