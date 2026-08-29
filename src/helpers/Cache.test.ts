import { clearAppCache } from "./Cache";

describe("clearAppCache", () => {
  it("deletes every app cache before reloading", async () => {
    const events: string[] = [];
    const cacheStorage = {
      keys: jest.fn(async () => ["electrify-v1", "electrify-old"]),
      delete: jest.fn(async (name: string) => {
        events.push(`delete ${name}`);
        return true;
      }),
    };
    const reload = jest.fn(() => events.push("reload"));

    await clearAppCache(cacheStorage, reload);

    expect(cacheStorage.delete).toHaveBeenCalledWith("electrify-v1");
    expect(cacheStorage.delete).toHaveBeenCalledWith("electrify-old");
    expect(events[events.length - 1]).toBe("reload");
  });

  it("still reloads in a browser without Cache Storage", async () => {
    const reload = jest.fn();

    await clearAppCache(undefined, reload);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("still reloads when clearing is refused", async () => {
    const error = new Error("storage blocked");
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const reload = jest.fn();

    await clearAppCache(
      {
        keys: jest.fn(async () => {
          throw error;
        }),
        delete: jest.fn(),
      },
      reload,
    );

    expect(warn).toHaveBeenCalledWith("Couldn't clear the app cache:", error);
    expect(reload).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
