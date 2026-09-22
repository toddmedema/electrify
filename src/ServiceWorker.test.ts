import { readFileSync } from "fs";
import { resolve } from "path";
import { runInNewContext } from "vm";

const workerSource = readFileSync(
  resolve(process.cwd(), "public/service-worker.js"),
  "utf8",
);

function response(ok = true) {
  return { ok, clone: () => response(ok) };
}

type WorkerResponse = ReturnType<typeof response>;
type FetchEvent = {
  request: { url: string; method: string; mode: string };
  respondWith: (result: Promise<WorkerResponse>) => void;
  waitUntil: (work: Promise<unknown>) => void;
};

function worker() {
  const handlers = new Map<string, (event: FetchEvent) => void>();
  const fetch = jest.fn<Promise<WorkerResponse>, unknown[]>();
  const put = jest.fn().mockResolvedValue(undefined);
  const match = jest.fn().mockResolvedValue(undefined);
  const open = jest.fn().mockResolvedValue({ put });
  runInNewContext(workerSource, {
    URL,
    fetch,
    caches: { match, open },
    self: {
      location: { origin: "https://electrify.test" },
      addEventListener: (name: string, handler: (event: FetchEvent) => void) =>
        handlers.set(name, handler),
    },
  });
  return {
    fetch,
    put,
    match,
    open,
    request(mode = "cors") {
      let result: Promise<WorkerResponse> | undefined;
      const work: Promise<unknown>[] = [];
      handlers.get("fetch")!({
        request: {
          url: "https://electrify.test/static/main.js",
          method: "GET",
          mode,
        },
        respondWith: (promise) => {
          result = promise;
        },
        waitUntil: (promise) => work.push(promise),
      });
      return { result: result!, work };
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
