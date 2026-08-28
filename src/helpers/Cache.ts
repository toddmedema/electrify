type AppCacheStorage = Pick<CacheStorage, "keys" | "delete">;

function getAppCacheStorage(): AppCacheStorage | undefined {
  return typeof caches === "undefined" ? undefined : caches;
}

/**
 * Removes this origin's service-worker caches without touching localStorage, where saves and
 * settings live. Reload only after every deletion settles so the service worker refills the cache
 * from the current deployment rather than racing the clear.
 */
export async function clearAppCache(
  cacheStorage: AppCacheStorage | undefined = getAppCacheStorage(),
  reload: () => void = () => window.location.reload(),
): Promise<void> {
  if (cacheStorage) {
    try {
      const names = await cacheStorage.keys();
      await Promise.all(names.map((name) => cacheStorage.delete(name)));
    } catch (error) {
      // A reload is still worthwhile if storage is unavailable or one stale entry disappeared
      // between listing and deletion.
      console.warn("Couldn't clear the app cache:", error);
    }
  }
  reload();
}
