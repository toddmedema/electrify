import { readFileSync } from "fs";
import { resolve } from "path";
import { runInNewContext } from "vm";
import { createHash, webcrypto } from "crypto";

const workerSource = readFileSync(
  resolve(process.cwd(), "public/service-worker.js"),
  "utf8",
);

function response(ok = true, body = "") {
  return {
    ok,
    clone: () => response(ok, body),
    text: async () => body,
    json: async () => JSON.parse(body),
    arrayBuffer: async () => Uint8Array.from(Buffer.from(body)).buffer,
  };
}

function jsonResponse(payload: unknown) {
  return response(true, JSON.stringify(payload));
}

type WorkerResponse = ReturnType<typeof response>;
type FetchRequest =
  string | { url: string; method: string; mode: string; integrity?: string };
type FetchEvent = {
  request: Exclude<FetchRequest, string>;
  respondWith: (result: Promise<WorkerResponse>) => void;
  waitUntil: (work: Promise<unknown>) => void;
};
type MessageEvent = {
  data: unknown;
  waitUntil: (work: Promise<unknown>) => void;
};
type WorkerEvent = FetchEvent | MessageEvent;

function worker() {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const fetch = jest.fn<
    Promise<WorkerResponse>,
    [FetchRequest, { cache?: string }?]
  >();
  const put = jest.fn().mockResolvedValue(undefined);
  const match = jest
    .fn<Promise<WorkerResponse | undefined>, [FetchRequest]>()
    .mockResolvedValue(undefined);
  const cacheMatch = jest
    .fn<Promise<WorkerResponse | undefined>, [string]>()
    .mockResolvedValue(undefined);
  const open = jest.fn().mockResolvedValue({ put, match: cacheMatch });
  runInNewContext(workerSource, {
    URL,
    crypto: webcrypto,
    btoa: (value: string) => Buffer.from(value, "binary").toString("base64"),
    Response: function (body: string) {
      return response(true, body);
    },
    fetch,
    caches: { match, open },
    self: {
      location: { origin: "https://electrify.test" },
      addEventListener: (name: string, handler: (event: WorkerEvent) => void) =>
        handlers.set(name, handler),
    },
  });
  return {
    fetch,
    put,
    match,
    cacheMatch,
    open,
    request(mode = "cors", path = "/static/main.js", integrity?: string) {
      let result: Promise<WorkerResponse> | undefined;
      const work: Promise<unknown>[] = [];
      handlers.get("fetch")!({
        request: {
          url: `https://electrify.test${path}`,
          method: "GET",
          mode,
          integrity,
        },
        respondWith: (promise) => {
          result = promise;
        },
        waitUntil: (promise) => work.push(promise),
      });
      return { result: result!, work };
    },
    message(data: unknown) {
      const work: Promise<unknown>[] = [];
      handlers.get("message")!({
        data,
        waitUntil: (promise: Promise<unknown>) => work.push(promise),
      });
      return work;
    },
  };
}

it("serves cached assets offline and handles the background refresh failure", async () => {
  const sw = worker();
  const cached = response();
  sw.match.mockResolvedValue(cached);
  sw.fetch.mockRejectedValue(new Error("offline"));
  const event = sw.request();

  expect(await event.result).toBe(cached);
  expect(event.work).toHaveLength(1);
  await expect(Promise.all(event.work)).resolves.toEqual([undefined]);
});

it.each(["cors", "navigate"])(
  "keeps cache writes alive without delaying the %s response",
  async (mode) => {
    const sw = worker();
    const fresh = response();
    sw.fetch.mockResolvedValue(fresh);
    let finishWrite!: () => void;
    let startWrite!: () => void;
    const startedWrite = new Promise<void>((resolve) => {
      startWrite = resolve;
    });
    sw.put.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
          startWrite();
        }),
    );
    const event = sw.request(mode);
    expect(await event.result).toBe(fresh);
    expect(event.work).toHaveLength(1);
    let finished = false;
    const lifetime = Promise.all(event.work).then(() => {
      finished = true;
    });
    await startedWrite;
    expect(sw.put).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    finishWrite();
    await lifetime;
    expect(finished).toBe(true);
  },
);

it.each(["cors", "navigate"])(
  "returns network responses when %s cache writes fail",
  async (mode) => {
    const sw = worker();
    const fresh = response();
    sw.fetch.mockResolvedValue(fresh);
    sw.put.mockRejectedValue(new Error("quota exceeded"));
    const event = sw.request(mode);
    expect(await event.result).toBe(fresh);
    await expect(Promise.all(event.work)).resolves.toEqual([undefined]);
  },
);

it("preserves the cached app shell when navigation returns a server error", async () => {
  const sw = worker();
  const failure = response(false);
  sw.fetch.mockResolvedValue(failure);
  const event = sw.request("navigate");
  expect(await event.result).toBe(failure);
  await Promise.all(event.work);
  expect(sw.put).not.toHaveBeenCalled();
});

it("falls back to the app shell for offline navigation", async () => {
  const sw = worker();
  const cached = response();
  sw.match.mockResolvedValue(cached);
  sw.fetch.mockRejectedValue(new Error("offline"));
  const event = sw.request("navigate");
  expect(await event.result).toBe(cached);
  expect(sw.match).toHaveBeenCalledWith("/");
  await Promise.all(event.work);
});

it("still reports a failed request when no cached asset exists", async () => {
  const sw = worker();
  sw.fetch.mockRejectedValue(new Error("offline"));
  const event = sw.request();
  await expect(event.result).rejects.toThrow("offline");
  await Promise.all(event.work);
});

const integrityFor = (body: string) =>
  `sha256-${createHash("sha256").update(body).digest("base64")}`;

/** A persistent cache shared by consecutive events, as in the real worker. */
function dataWorker() {
  const sw = worker();
  const entries = new Map<string, WorkerResponse>();
  const path = (request: FetchRequest) =>
    new URL(
      typeof request === "string" ? request : request.url,
      "https://electrify.test",
    ).pathname;
  sw.match.mockImplementation(async (request) =>
    entries.get(path(request))?.clone(),
  );
  sw.cacheMatch.mockImplementation(async (request) =>
    entries.get(path(request))?.clone(),
  );
  sw.put.mockImplementation(
    async (request: FetchRequest, value: WorkerResponse) => {
      entries.set(path(request), value.clone());
    },
  );
  sw.open.mockResolvedValue({
    put: sw.put,
    match: sw.cacheMatch,
    keys: async () =>
      [...entries.keys()].map((key) => ({
        url: `https://electrify.test${key}`,
      })),
  });
  return { ...sw, entries, path };
}

describe("simulation data integrity", () => {
  const url = "/data/weather/PIT.bin";
  it.each([url, "/data/FuelPricesRaw.csv"])(
    "replaces obsolete %s bytes, then serves the current build offline",
    async (url) => {
      const sw = dataWorker();
      sw.entries.set(url, response(true, "old"));
      sw.fetch.mockResolvedValue(response(true, "fresh"));
      expect(
        await (
          await sw.request("cors", url, integrityFor("fresh")).result
        ).text(),
      ).toBe("fresh");
      expect(await sw.entries.get(url)!.text()).toBe("fresh");
      expect(sw.fetch).toHaveBeenCalledWith(
        expect.objectContaining({ integrity: integrityFor("fresh") }),
        { cache: "no-cache" },
      );
      sw.fetch.mockRejectedValue(new Error("offline"));
      expect(
        await (
          await sw.request("cors", url, integrityFor("fresh")).result
        ).text(),
      ).toBe("fresh");
      expect(sw.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["offline", "wrong bytes"])(
    "rejects stale cache when the network gives %s",
    async (failure) => {
      const sw = dataWorker();
      sw.entries.set(url, response(true, "old"));
      if (failure === "offline")
        sw.fetch.mockRejectedValue(new Error("offline"));
      else sw.fetch.mockResolvedValue(response(true, "wrong"));
      await expect(
        sw.request("cors", url, integrityFor("fresh")).result,
      ).rejects.toThrow();
      expect(await sw.entries.get(url)!.text()).toBe("old");
    },
  );

  it("returns verified network data even if its cache write fails", async () => {
    const sw = dataWorker();
    sw.put.mockRejectedValue(new Error("quota"));
    sw.fetch.mockResolvedValue(response(true, "fresh"));
    expect(
      await (
        await sw.request("cors", url, integrityFor("fresh")).result
      ).text(),
    ).toBe("fresh");
  });

  it("never coalesces integrity-free prefetches or different build hashes", async () => {
    const sw = dataWorker();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    sw.fetch.mockImplementation(async (request) => {
      if (sw.path(request) !== url) return response();
      await waiting;
      const integrity =
        typeof request === "string" ? undefined : request.integrity;
      return response(
        true,
        integrity === integrityFor("fresh") ? "fresh" : "old",
      );
    });
    const prefetch = sw.message({
      type: "CACHE_SCENARIO_DATA",
      locationIds: ["PIT"],
    });
    const current = sw.request("cors", url, integrityFor("fresh")).result;
    const older = sw.request("cors", url, integrityFor("old")).result;
    release();
    expect(await (await current).text()).toBe("fresh");
    expect(await (await older).text()).toBe("old");
    await Promise.all(prefetch);
    expect(
      sw.fetch.mock.calls.filter(([request]) => sw.path(request) === url),
    ).toHaveLength(3);
  });
});

describe("SYNC_OFFLINE_DATA", () => {
  it.each(["network", "cache", "marker"])(
    "retries a failed %s write/download even when the ordinary index is current",
    async (failure) => {
      const sw = dataWorker();
      const weather = "/data/weather/PIT.bin";
      const index = JSON.stringify({ updated: "new", cities: { PIT: {} } });
      sw.entries.set("/data/weather/index.json", response(true, index));
      sw.entries.set(weather, response(true, "old"));
      let failing = true;
      sw.fetch.mockImplementation(async (request) => {
        const path = sw.path(request);
        if (path === "/data/weather/index.json") return response(true, index);
        if (path === weather && failing && failure === "network")
          throw new Error("offline");
        return response(true, "fresh");
      });
      const durablePut = sw.put.getMockImplementation()!;
      sw.put.mockImplementation(
        async (request: FetchRequest, value: WorkerResponse) => {
          if (
            failing &&
            ((failure === "cache" && sw.path(request) === weather) ||
              (failure === "marker" &&
                sw.path(request) === "/__offline-data-revision"))
          )
            throw new Error("quota");
          return durablePut(request, value);
        },
      );
      await Promise.all(sw.message({ type: "SYNC_OFFLINE_DATA" }));
      expect(sw.entries.has("/__offline-data-revision")).toBe(false);
      expect(await sw.entries.get(weather)!.text()).toBe(
        failure === "marker" ? "fresh" : "old",
      );
      failing = false;
      await Promise.all(sw.message({ type: "SYNC_OFFLINE_DATA" }));
      expect(await sw.entries.get(weather)!.text()).toBe("fresh");
      expect(
        sw.fetch.mock.calls.filter(([request]) => sw.path(request) === weather),
      ).toHaveLength(2);
      await Promise.all(sw.message({ type: "SYNC_OFFLINE_DATA" }));
      expect(
        sw.fetch.mock.calls.filter(([request]) => sw.path(request) === weather),
      ).toHaveLength(2);
    },
  );
});

describe("CACHE_ICONS", () => {
  const manifest = ["/images/transmission.svg", "/images/solar.svg"];

  function iconWorker() {
    const sw = worker();
    sw.fetch.mockImplementation(async (url) => {
      if (typeof url === "string" && url === "/icons.json") {
        return jsonResponse(manifest);
      }
      return response();
    });
    return sw;
  }

  it("downloads every icon from the manifest and caches the manifest itself", async () => {
    const sw = iconWorker();

    await Promise.all(sw.message({ type: "CACHE_ICONS" }));

    expect(sw.fetch).toHaveBeenCalledWith("/icons.json", { cache: "no-cache" });
    expect(sw.fetch).toHaveBeenCalledWith("/images/transmission.svg", {
      cache: "no-cache",
    });
    expect(sw.fetch).toHaveBeenCalledWith("/images/solar.svg", {
      cache: "no-cache",
    });
    expect(sw.put).toHaveBeenCalledWith("/icons.json", expect.anything());
    expect(sw.put).toHaveBeenCalledWith(
      "/images/transmission.svg",
      expect.anything(),
    );
  });

  it("skips icons that are already cached", async () => {
    const sw = iconWorker();
    sw.cacheMatch.mockImplementation(async (url) =>
      url === "/images/solar.svg" ? response() : undefined,
    );

    await Promise.all(sw.message({ type: "CACHE_ICONS" }));

    expect(sw.fetch).not.toHaveBeenCalledWith("/images/solar.svg", {
      cache: "no-cache",
    });
    expect(sw.fetch).toHaveBeenCalledWith("/images/transmission.svg", {
      cache: "no-cache",
    });
  });

  it("falls back to the cached manifest when offline and still attempts every icon", async () => {
    const sw = worker();
    sw.fetch.mockRejectedValue(new Error("offline"));
    sw.cacheMatch.mockImplementation(async (url) =>
      url === "/icons.json" ? jsonResponse(manifest) : undefined,
    );

    // Offline icon downloads fail, but the background work must settle rather than reject.
    await expect(
      Promise.all(sw.message({ type: "CACHE_ICONS" })),
    ).resolves.toEqual([undefined]);

    expect(sw.fetch).toHaveBeenCalledWith("/images/transmission.svg", {
      cache: "no-cache",
    });
    expect(sw.fetch).toHaveBeenCalledWith("/images/solar.svg", {
      cache: "no-cache",
    });
  });

  it("ignores manifest entries that are not same-origin image paths", async () => {
    const sw = worker();
    sw.fetch.mockImplementation(async (url) => {
      if (typeof url === "string" && url === "/icons.json") {
        return jsonResponse([
          "/data/FuelPricesRaw.csv",
          "https://example.com/images/evil.svg",
          42,
          "/images/transmission.svg",
        ]);
      }
      return response();
    });

    await Promise.all(sw.message({ type: "CACHE_ICONS" }));

    // Only the manifest and the one valid image path are fetched.
    expect(sw.fetch).toHaveBeenCalledTimes(2);
    expect(sw.fetch).toHaveBeenCalledWith("/icons.json", { cache: "no-cache" });
    expect(sw.fetch).toHaveBeenCalledWith("/images/transmission.svg", {
      cache: "no-cache",
    });
    expect(sw.fetch).not.toHaveBeenCalledWith("/data/FuelPricesRaw.csv", {
      cache: "no-cache",
    });
  });

  it("ignores a malformed manifest", async () => {
    const sw = worker();
    sw.fetch.mockImplementation(async (url) => {
      if (typeof url === "string" && url === "/icons.json") {
        return jsonResponse({ icons: manifest });
      }
      return response();
    });

    await Promise.all(sw.message({ type: "CACHE_ICONS" }));

    expect(sw.fetch).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the manifest is missing and offline", async () => {
    const sw = worker();
    sw.fetch.mockRejectedValue(new Error("offline"));

    await expect(
      Promise.all(sw.message({ type: "CACHE_ICONS" })),
    ).resolves.toEqual([undefined]);

    expect(sw.fetch).toHaveBeenCalledTimes(1);
  });
  function workerWithManifest(entries: unknown) {
    const sw = worker();
    sw.fetch.mockImplementation(async (url) =>
      url === "/icons.json" ? jsonResponse(entries) : response(),
    );
    return sw;
  }

  function fetchedUrls(sw: ReturnType<typeof worker>) {
    return sw.fetch.mock.calls.map(([url]) => url);
  }

  it("fetches and caches percent-encoded names under the key the page requests", async () => {
    const sw = workerWithManifest(["/images/natural%20gas.svg"]);

    await Promise.all(sw.message({ type: "CACHE_ICONS" }));

    expect(sw.cacheMatch).toHaveBeenCalledWith("/images/natural%20gas.svg");
    expect(sw.put).toHaveBeenCalledWith(
      "/images/natural%20gas.svg",
      expect.anything(),
    );
  });

  it("downloads a duplicated manifest entry once", async () => {
    const sw = workerWithManifest(["/images/solar.svg", "/images/solar.svg"]);

    await Promise.all(sw.message({ type: "CACHE_ICONS" }));

    expect(fetchedUrls(sw)).toEqual(["/icons.json", "/images/solar.svg"]);
  });

  it("keeps downloading the rest when one icon fails", async () => {
    const sw = worker();
    sw.fetch.mockImplementation(async (url) => {
      if (url === "/icons.json") {
        return jsonResponse(manifest);
      }
      if (url === "/images/transmission.svg") {
        return response(false);
      }
      return response();
    });

    await expect(
      Promise.all(sw.message({ type: "CACHE_ICONS" })),
    ).resolves.toEqual([undefined]);

    expect(sw.put).not.toHaveBeenCalledWith(
      "/images/transmission.svg",
      expect.anything(),
    );
    expect(sw.put).toHaveBeenCalledWith("/images/solar.svg", expect.anything());
  });

  it("falls back to the cached manifest when the server returns an error", async () => {
    const sw = worker();
    sw.fetch.mockImplementation(async (url) =>
      url === "/icons.json" ? response(false) : response(),
    );
    sw.cacheMatch.mockImplementation(async (url) =>
      url === "/icons.json" ? jsonResponse(manifest) : undefined,
    );

    await Promise.all(sw.message({ type: "CACHE_ICONS" }));

    // A failed manifest response must never replace the good cached copy.
    expect(sw.put).not.toHaveBeenCalledWith("/icons.json", expect.anything());
    expect(fetchedUrls(sw)).toEqual([
      "/icons.json",
      "/images/transmission.svg",
      "/images/solar.svg",
    ]);
  });

  it("ignores a manifest that is not JSON", async () => {
    const sw = worker();
    sw.fetch.mockResolvedValue({
      ok: true,
      clone() {
        return this;
      },
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    } as unknown as WorkerResponse);

    await expect(
      Promise.all(sw.message({ type: "CACHE_ICONS" })),
    ).resolves.toEqual([undefined]);
    expect(fetchedUrls(sw)).toEqual(["/icons.json"]);
  });

  it("still downloads every icon when the cache refuses writes", async () => {
    const sw = iconWorker();
    sw.put.mockRejectedValue(new Error("QuotaExceededError"));

    await expect(
      Promise.all(sw.message({ type: "CACHE_ICONS" })),
    ).resolves.toEqual([undefined]);
    expect(fetchedUrls(sw)).toEqual([
      "/icons.json",
      "/images/transmission.svg",
      "/images/solar.svg",
    ]);
  });

  it("shares downloads between overlapping requests", async () => {
    const sw = iconWorker();

    // The launch timer and a reconnect can both ask before either finishes.
    await Promise.all([
      ...sw.message({ type: "CACHE_ICONS" }),
      ...sw.message({ type: "CACHE_ICONS" }),
    ]);

    expect(fetchedUrls(sw).sort()).toEqual([
      "/icons.json",
      "/images/solar.svg",
      "/images/transmission.svg",
    ]);
  });
});
