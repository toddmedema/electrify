/** Stop waiting when a UI operation is canceled, while still observing its late rejection. */
export function waitForSaveOperation<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(saveOperationAborted());
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export function saveOperationAborted(): DOMException {
  return new DOMException("The saved-game action was canceled.", "AbortError");
}
