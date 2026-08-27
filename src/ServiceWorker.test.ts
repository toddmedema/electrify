import { SnackbarType } from "./Types";
import { watchForServiceWorkerUpdates } from "./ServiceWorker";

function setup(controller: ServiceWorker | null) {
  const waitingWorker = { postMessage: jest.fn() } as unknown as ServiceWorker;
  const serviceWorkerListeners: Record<string, EventListener> = {};
  const registrationListeners: Record<string, EventListener> = {};
  const serviceWorker = {
    controller,
    addEventListener: jest.fn((event: string, listener: EventListener) => {
      serviceWorkerListeners[event] = listener;
    }),
  } as unknown as ServiceWorkerContainer;
  const registration = {
    waiting: waitingWorker,
    installing: null,
    addEventListener: jest.fn((event: string, listener: EventListener) => {
      registrationListeners[event] = listener;
    }),
  } as unknown as ServiceWorkerRegistration;
  const dispatch = jest.fn();
  const reload = jest.fn();

  watchForServiceWorkerUpdates(serviceWorker, registration, dispatch, reload);

  return {
    dispatch,
    registration,
    registrationListeners,
    reload,
    serviceWorkerListeners,
    waitingWorker,
  };
}

describe("service worker updates", () => {
  it("does not offer an update on a page's first service-worker load", () => {
    const { dispatch } = setup(null);

    expect(dispatch).not.toHaveBeenCalled();
  });

  it("offers a waiting update to a returning visitor", () => {
    const { dispatch } = setup({} as ServiceWorker);

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ui/snackbarOpen",
        payload: expect.objectContaining({
          message: "An Electrify update is ready.",
          actionLabel: "Update",
        }),
      }),
    );
  });

  it("activates the worker offered by the prompt and reloads when it takes control", () => {
    const {
      dispatch,
      registration,
      reload,
      serviceWorkerListeners,
      waitingWorker,
    } = setup({} as ServiceWorker);
    const snackbar = dispatch.mock.calls[0][0].payload as SnackbarType;

    Object.defineProperty(registration, "waiting", { value: null });
    snackbar.action?.({} as React.MouseEvent<HTMLElement>);
    expect(waitingWorker.postMessage).toHaveBeenCalledWith({
      type: "SKIP_WAITING",
    });

    serviceWorkerListeners.controllerchange(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
