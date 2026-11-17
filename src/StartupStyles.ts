/** Deferred styles can fail before an entry module attaches its listeners. */
export async function waitForAppStyles(): Promise<void> {
  if (document.querySelector("link[data-app-style-error]"))
    throw new Error("App stylesheet unavailable");
  await Promise.all(
    Array.from(
      document.querySelectorAll<HTMLLinkElement>("link[data-app-style]"),
    )
      .filter((link) => !link.sheet)
      .map(
        (link) =>
          new Promise<void>((resolve, reject) => {
            const cleanup = () => {
              link.removeAttribute("data-app-style");
              link.removeEventListener("load", loaded);
              link.removeEventListener("error", failed);
            };
            const loaded = () => {
              cleanup();
              resolve();
            };
            const failed = () => {
              link.dataset.appStyleError = "true";
              cleanup();
              reject(new Error("App stylesheet unavailable"));
            };
            link.addEventListener("load", loaded);
            link.addEventListener("error", failed);
          }),
      ),
  );
}
