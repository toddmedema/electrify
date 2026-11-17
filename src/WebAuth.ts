import type { Auth, User } from "firebase/auth";

type DeferredWebAuth = Pick<Auth, "currentUser" | "onAuthStateChanged"> & {
  initialize(): Auth;
  confirmSignedOut(): void;
};

/** Register account consumers without starting Firebase for a first-time title-screen visitor. */
export function deferredWebAuth(create: () => Auth): DeferredWebAuth {
  let auth: Auth | undefined;
  let signedOut = false;
  const listeners = new Set<{
    next: (user: User | null) => void;
    stop?: () => void;
  }>();
  const initialize = () => {
    if (!auth) {
      auth = create();
      for (const listener of listeners)
        listener.stop = auth.onAuthStateChanged(listener.next);
    }
    return auth;
  };
  return {
    initialize,
    confirmSignedOut() {
      if (auth || signedOut) return;
      signedOut = true;
      for (const listener of listeners) listener.next(null);
    },
    get currentUser() {
      return auth?.currentUser || null;
    },
    onAuthStateChanged(next) {
      const callback =
        typeof next === "function" ? next : next.next?.bind(next) || (() => {});
      const listener = {
        next: callback,
        stop: auth?.onAuthStateChanged(callback),
      };
      listeners.add(listener);
      if (signedOut && !auth)
        queueMicrotask(() => {
          if (!auth && listeners.has(listener)) listener.next(null);
        });
      return () => {
        listener.stop?.();
        listeners.delete(listener);
      };
    },
  };
}

/** Firebase persisted sessions must still resume automatically, including older IndexedDB sessions. */
export async function hasStoredWebAccount(): Promise<boolean> {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key?.startsWith("firebase:authUser:") &&
        localStorage.getItem(key) !== "null"
      )
        return true;
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (
        key?.startsWith("firebase:authUser:") &&
        sessionStorage.getItem(key) !== "null"
      )
        return true;
    }
  } catch {
    /* Storage can be denied while IndexedDB remains available. */
  }
  if (typeof indexedDB === "undefined") return false;
  try {
    if (
      indexedDB.databases &&
      !(await indexedDB.databases()).some(
        (db) => db.name === "firebaseLocalStorageDb",
      )
    )
      return false;
    return await new Promise<boolean>((resolve) => {
      const request = indexedDB.open("firebaseLocalStorageDb");
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        resolve(false);
      };
      request.onerror = () => resolve(false);
      request.onblocked = () => resolve(false);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("firebaseLocalStorage")) {
          db.close();
          resolve(false);
          return;
        }
        const transaction = db.transaction("firebaseLocalStorage", "readonly");
        const accounts = transaction
          .objectStore("firebaseLocalStorage")
          .getAll();
        accounts.onsuccess = () =>
          resolve(
            accounts.result.some(
              (row) =>
                String(row.fbase_key).startsWith("firebase:authUser:") &&
                !!row.value,
            ),
          );
        accounts.onerror = () => resolve(false);
        transaction.oncomplete = transaction.onabort = () => db.close();
      };
    });
  } catch {
    return false;
  }
}
