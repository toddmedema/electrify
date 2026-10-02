import { SaveRepositoryError } from "./SaveModel";

export interface SaveWriterLock {
  release(): Promise<void>;
}

export function supportsSaveWriterLocks(): boolean {
  return typeof navigator !== "undefined" && !!navigator.locks?.request;
}

/**
 * Session storage is cloned by window.open. A token lock permits reload handoff only after
 * the old document has gone, without preventing a fresh writer taking an expired IDB lease.
 * IndexedDB ownership and revision checks remain the authority for the save itself.
 */
export async function acquireSaveWriterLock(
  token: string,
): Promise<SaveWriterLock> {
  if (!supportsSaveWriterLocks()) return { release: async () => undefined };
  let unlock!: () => void;
  const held = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  return new Promise<SaveWriterLock>((resolve, reject) => {
    const lifetime = navigator.locks.request(
      `electrify-save-writer:${token}`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          reject(
            new SaveRepositoryError(
              "conflict",
              "This game is open in another tab.",
            ),
          );
          return;
        }
        resolve({
          release: async () => {
            unlock();
            await lifetime;
          },
        });
        await held;
      },
    );
    void lifetime.catch(reject);
  });
}
