const CACHE_VERSION = "electrify-v2";
const WEATHER_INDEX = "/data/weather/index.json";
const MARKET_DATA = ["/data/FuelPricesRaw.csv", "/data/EconomyRaw.csv"];
const APP_SHELL = [
  "/",
  "/manifest.json",
  "/images/logo.svg",
  "/images/icon/192x192.png",
  "/images/icon/512x512.png",
  WEATHER_INDEX,
  ...MARKET_DATA,
];

async function fetchAndCache(cache, url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`${response.status} fetching ${url}`);
  }
  await cache.put(url, response.clone());
  return response;
}

/**
 * An installed app asks for this after launch has gone idle. Compare the catalog first: an
 * unchanged one only fills holes, while a changed catalog refreshes every location because its
 * update date means the packed records may have changed in place.
 */
async function syncOfflineData() {
  const cache = await caches.open(CACHE_VERSION);
  const cachedIndex = await cache.match(WEATHER_INDEX);
  const cachedText = cachedIndex ? await cachedIndex.clone().text() : "";
  const indexResponse = await fetchAndCache(cache, WEATHER_INDEX);
  const indexText = await indexResponse.clone().text();
  const index = JSON.parse(indexText);
  const weatherUrls = Object.keys(index.cities || {}).map(
    (id) => `/data/weather/${id}.bin`,
  );
  const cachedUrls = new Set(
    (await cache.keys()).map((request) => new URL(request.url).pathname),
  );
  const weatherToFetch =
    cachedText !== indexText
      ? weatherUrls
      : weatherUrls.filter((url) => !cachedUrls.has(url));

  await Promise.allSettled(
    [...MARKET_DATA, ...weatherToFetch].map((url) => fetchAndCache(cache, url)),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SYNC_OFFLINE_DATA") {
    event.waitUntil(syncOfflineData());
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  if (/\/data\/weather\/.*\.bin$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches
              .open(CACHE_VERSION)
              .then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });
      return cached || network;
    }),
  );
});
