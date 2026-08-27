import { snackbarOpen } from "./reducers/UI";

type DispatchSnackbar = (action: ReturnType<typeof snackbarOpen>) => unknown;

/**
 * Offers an update only to pages already running under a service worker.
 *
 * A first-time visitor has no controller. Their newly installed worker activates on its own, so
 * asking them to update is both unnecessary and misleading. Returning visitors can have a waiting
 * worker, and need the prompt so it can take over without waiting for every tab to close.
 */
export function watchForServiceWorkerUpdates(
  serviceWorker: ServiceWorkerContainer,
  registration: ServiceWorkerRegistration,
  dispatch: DispatchSnackbar,
  reload: () => void,
): void {
  let reloadForUpdate = false;

  serviceWorker.addEventListener("controllerchange", () => {
    if (reloadForUpdate) {
      reload();
    }
  });

  const offerUpdate = () => {
    const waitingWorker = registration.waiting;
    if (!serviceWorker.controller || !waitingWorker) {
      return;
    }

    dispatch(
      snackbarOpen({
        message: "An Electrify update is ready.",
        actionLabel: "Update",
        action: () => {
          reloadForUpdate = true;
          waitingWorker.postMessage({ type: "SKIP_WAITING" });
        },
        open: true,
        timeout: 12000,
      }),
    );
  };

  offerUpdate();
  registration.addEventListener("updatefound", () => {
    registration.installing?.addEventListener("statechange", offerUpdate);
  });
}
