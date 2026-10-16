/** Await a callback-style data loader such as initEconomy; safe in workers. */
export function waitForLoad(
  initialize: (done: (failure?: string) => void) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    initialize((failure?: string) => {
      if (failure) {
        reject(new Error(failure));
      } else {
        resolve();
      }
    });
  });
}
