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
const LOCATION_ID = /^[A-Za-z0-9_-]{1,32}$/;
const inFlightFetches = new Map();

function absoluteUrl(request) {
  return new URL(
    typeof request === "string" ? request : request.url,
    self.location.origin,
  ).href;
}

async function fetchAndCache(cache, url) {
  const key = absoluteUrl(url);
  let pending = inFlightFetches.get(key);
  if (!pending) {
    pending = fetch(url, { cache: "no-cache" }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`${response.status} fetching ${key}`);
      }
      try {
        await cache.put(url, response.clone());
      } catch {
        // A full or unavailable cache must not turn a successful network response into a failed
        // game load. Prefetching is best-effort; the caller can still use the downloaded response.
      }
      return response;
    });
    inFlightFetches.set(key, pending);
  }

  try {
    return (await pending).clone();
  } finally {
    if (inFlightFetches.get(key) === pending) {
      inFlightFetches.delete(key);
    }
  }
}

/** Fill any holes for one scenario without refreshing data that is already available offline. */
async function cacheScenarioData(locationIds) {
  const weatherUrls = Array.isArray(locationIds)
    ? [...new Set(locationIds)]
        .filter((id) => typeof id === "string" && LOCATION_ID.test(id))
        .map((id) => `/data/weather/${id}.bin`)
    : [];
  const urls = [...MARKET_DATA, ...weatherUrls];
  const cache = await caches.open(CACHE_VERSION);
  const missing = (
    await Promise.all(
      urls.map(async (url) => ({ url, cached: await cache.match(url) })),
    )
  )
    .filter(({ cached }) => !cached)
    .map(({ url }) => url);

  await Promise.allSettled(missing.map((url) => fetchAndCache(cache, url)));
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
  } else if (event.data?.type === "CACHE_SCENARIO_DATA") {
    event.waitUntil(cacheScenarioData(event.data.locationIds));
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
      caches.match(request).then(async (cached) => {
        if (cached) {
          return cached;
        }
        const cache = await caches.open(CACHE_VERSION);
        return fetchAndCache(cache, request);
      }),
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
