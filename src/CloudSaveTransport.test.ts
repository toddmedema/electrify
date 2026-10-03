import { TextEncoder } from "util";
import { randomFillSync } from "crypto";
import {
  getDocFromServer,
  getDocsFromServer,
  runTransaction,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import {
  CloudConflict,
  createSharedSave,
  FirebaseSaveTransport,
  loadSharedSave,
  newShareId,
  saveChunks,
  SHARE_ID_PATTERN,
  SHARE_LIFETIME_MS,
} from "./CloudSaveTransport";
import { encodeSaveFile } from "./SaveFile";
import { fakeSaveFile } from "./testing/SaveTestHelpers";
import type { SaveRecord } from "./Types";

jest.mock("./Globals", () => ({ getDb: () => ({}) }));
jest.mock("firebase/firestore", () => {
  class MockTimestamp {
    constructor(private mockMillis: number) {}
    static fromMillis(mockMillis: number) {
      return new MockTimestamp(mockMillis);
    }
    toMillis() {
      return this.mockMillis;
    }
  }
  return {
    collection: (_db: unknown, ...path: string[]) => path.join("/"),
    doc: (_db: unknown, ...path: string[]) => path.join("/"),
    getDocFromServer: jest.fn(),
    getDocsFromServer: jest.fn(),
    runTransaction: jest.fn(),
    writeBatch: jest.fn(),
    serverTimestamp: () => "server timestamp",
    Timestamp: MockTimestamp,
  };
});

if (!globalThis.TextEncoder) {
  Object.defineProperty(globalThis, "TextEncoder", { value: TextEncoder });
}
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: {
      getRandomValues: (values: Uint8Array) => randomFillSync(values),
    },
  });
}

type Document = Record<string, unknown>;
type Write = {
  path: string;
  data?: Document;
  kind: "set" | "update" | "delete";
};
const SHARE_ID = "ABCdef1234";
const BLOB_ID = "a".repeat(32);
const OLD_VERSION = "b".repeat(32);
const snapshot = (data?: Document) => ({
  exists: () => data !== undefined,
  data: () => data,
});

describe("CloudSaveTransport", () => {
  let documents: Map<string, Document>;
  let commits: Write[][];
  let reads: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    documents = new Map();
    commits = [];
    reads = jest.fn(async (path: string) => snapshot(documents.get(path)));
    (getDocFromServer as jest.Mock).mockImplementation(reads);
    (writeBatch as jest.Mock).mockImplementation(() => {
      const writes: Write[] = [];
      return {
        delete: (path: string) => writes.push({ path, kind: "delete" }),
        commit: jest.fn(async () => {
          for (const { path } of writes) documents.delete(path);
          commits.push(writes);
        }),
      };
    });
    (runTransaction as jest.Mock).mockImplementation(
      async (
        _db: unknown,
        execute: (transaction: unknown) => Promise<unknown>,
      ) => {
        const writes: Write[] = [];
        const result = await execute({
          get: reads,
          set: (path: string, data: Document) =>
            writes.push({ path, data, kind: "set" }),
          update: (path: string, data: Document) =>
            writes.push({ path, data, kind: "update" }),
          delete: (path: string) => writes.push({ path, kind: "delete" }),
        });
        for (const { path, data, kind } of writes) {
          if (kind === "delete") documents.delete(path);
          else
            documents.set(
              path,
              kind === "update" ? { ...documents.get(path), ...data } : data!,
            );
        }
        commits.push(writes);
        return result;
      },
    );
  });

  afterEach(() => jest.restoreAllMocks());

  function shared(file = fakeSaveFile()) {
    documents.set(`sharedGames/${SHARE_ID}`, {
      uid: "creator",
      chunks: [BLOB_ID],
      expiresAt: Timestamp.fromMillis(Date.now() + SHARE_LIFETIME_MS),
    });
    documents.set(`saveBlobs/${BLOB_ID}`, {
      data: JSON.stringify(encodeSaveFile(file)),
      uid: "creator",
      shareId: SHARE_ID,
    });
    return file;
  }

  it("uses ten alphanumeric characters and rejects biased random bytes", () => {
    const random = jest.spyOn(crypto, "getRandomValues");
    random.mockImplementationOnce((bytes) => {
      (bytes as Uint8Array).fill(255);
      return bytes;
    });
    const id = newShareId();
    expect(id).toMatch(SHARE_ID_PATTERN);
    expect(random).toHaveBeenCalledTimes(2);
  });

  it("round trips the actual lossless encoding across bounded chunks", () => {
    const file = fakeSaveFile();
    Object.assign(file.save.game, {
      reviewPadding: "a".repeat(149_950) + "😀".repeat(10_000),
    });
    const chunks = saveChunks(file);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 150_000)).toBe(true);
    expect(
      chunks.every(
        (chunk) => new TextEncoder().encode(chunk).length <= 600_000,
      ),
    ).toBe(true);
    expect(
      chunks.slice(0, -1).every((chunk) => !/[\uD800-\uDBFF]$/.test(chunk)),
    ).toBe(true);
    expect(JSON.parse(chunks.join(""))).toEqual(encodeSaveFile(file));
  });

  it("rejects a payload over the byte limit before contacting Firebase", async () => {
    const file = fakeSaveFile();
    Object.assign(file.save.game, { reviewPadding: "😀".repeat(3_000_000) });
    await expect(createSharedSave("creator", file)).rejects.toThrow(
      "too large",
    );
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("creates independent frozen payloads and manifest in one transaction", async () => {
    const file = fakeSaveFile();
    const now = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(now);
    const url = await createSharedSave("creator", file);
    expect(url).toMatch(
      /^https:\/\/electrifygame\.com\/\?game=[A-Za-z0-9]{10}$/,
    );
    const manifest = documents.get(`sharedGames/${url.split("=")[1]}`)!;
    const chunks = manifest.chunks as string[];
    const frozen = documents.get(`saveBlobs/${chunks[0]}`)!;
    expect(commits).toHaveLength(1);
    expect(commits[0]).toHaveLength(chunks.length + 1);
    expect((manifest.expiresAt as Timestamp).toMillis()).toBe(
      now + SHARE_LIFETIME_MS,
    );
    expect(frozen.expiresAt).toBe(manifest.expiresAt);
    expect(frozen.uid).toBe("creator");
    file.name = "Changed after sharing";
    file.save.game.customerRate = 0.5;
    expect(JSON.parse(frozen.data as string).name).toBe(
      "Renewables experiment",
    );
    expect(JSON.parse(frozen.data as string).save.game.customerRate).toBe(0.07);
    const next = await createSharedSave("creator", file);
    expect(next).not.toBe(url);
    const nextManifest = documents.get(`sharedGames/${next.split("=")[1]}`)!;
    expect(nextManifest.chunks).not.toEqual(chunks);
  });

  it("retries an occupied share identifier without changing its payload", async () => {
    reads.mockImplementationOnce(async (path: string) => {
      documents.set(path, { uid: "someone else", chunks: [BLOB_ID] });
      return snapshot(documents.get(path));
    });
    await expect(createSharedSave("creator", fakeSaveFile())).resolves.toMatch(
      /\?game=/,
    );
    expect(runTransaction).toHaveBeenCalledTimes(2);
    expect(commits[0]).toEqual([]);
    expect(
      [...documents.values()].some((data) => data.uid === "someone else"),
    ).toBe(true);
  });

  it("fails after bounded collision retries", async () => {
    reads.mockResolvedValue(snapshot({ chunks: [BLOB_ID] }));
    await expect(createSharedSave("creator", fakeSaveFile())).rejects.toThrow(
      "try again",
    );
    expect(runTransaction).toHaveBeenCalledTimes(5);
    expect(commits.every((writes) => writes.length === 0)).toBe(true);
  });

  it("loads without authentication and renews every chunk with the manifest atomically", async () => {
    const file = shared();
    expect(await loadSharedSave(SHARE_ID)).toEqual(file);
    expect(commits).toHaveLength(1);
    expect(commits[0].map((write) => write.path)).toEqual([
      `sharedGames/${SHARE_ID}`,
      `saveBlobs/${BLOB_ID}`,
    ]);
    expect(documents.get(`saveBlobs/${BLOB_ID}`)?.expiresAt).toBe(
      documents.get(`sharedGames/${SHARE_ID}`)?.expiresAt,
    );
    expect(commits[0][1].data).toEqual({
      expiresAt: commits[0][0].data?.expiresAt,
    });
  });

  it.each(["../ABCdef1234", "a".repeat(11), "abc", "ABCdef123!"])(
    "rejects invalid share ID %s before a read",
    async (id) => {
      await expect(loadSharedSave(id)).rejects.toThrow("invalid");
      expect(getDocFromServer).not.toHaveBeenCalled();
    },
  );

  it("never extends retention for an expired link", async () => {
    shared();
    documents.get(`sharedGames/${SHARE_ID}`)!.expiresAt = Timestamp.fromMillis(
      Date.now() - 1,
    );
    await expect(loadSharedSave(SHARE_ID)).rejects.toThrow("expired");
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it.each(["permission-denied", "not-found"])(
    "explains unavailable shared manifests for Firebase %s errors",
    async (code) => {
      (getDocFromServer as jest.Mock).mockRejectedValueOnce(
        Object.assign(new Error("Firebase service details"), { code }),
      );
      await expect(loadSharedSave(SHARE_ID)).rejects.toThrow(
        "This shared game has expired or is no longer available.",
      );
      expect(getDocFromServer).toHaveBeenCalledTimes(1);
      expect(runTransaction).not.toHaveBeenCalled();
    },
  );

  it("preserves a shared-manifest connectivity failure for retry", async () => {
    const failure = Object.assign(new Error("Network unavailable"), {
      code: "unavailable",
    });
    (getDocFromServer as jest.Mock).mockRejectedValueOnce(failure);
    await expect(loadSharedSave(SHARE_ID)).rejects.toBe(failure);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "{broken json",
    JSON.stringify({ name: "Invalid", status: "inProgress", save: {} }),
  ])(
    "rejects missing or invalid chunks before extending retention",
    async (data) => {
      shared();
      if (data === undefined) documents.delete(`saveBlobs/${BLOB_ID}`);
      else documents.get(`saveBlobs/${BLOB_ID}`)!.data = data;
      await expect(loadSharedSave(SHARE_ID)).rejects.toThrow();
      expect(runTransaction).not.toHaveBeenCalled();
    },
  );

  it("propagates permission failures without returning a share URL", async () => {
    (runTransaction as jest.Mock).mockRejectedValue(
      new Error("permission-denied"),
    );
    await expect(createSharedSave("creator", fakeSaveFile())).rejects.toThrow(
      "permission-denied",
    );
    expect(documents.size).toBe(0);
  });

  it("isolates malformed cloud manifests before fetching their payload", async () => {
    (getDocsFromServer as jest.Mock).mockResolvedValue({
      docs: [
        {
          id: "save-one",
          data: () => ({
            version: OLD_VERSION,
            deleted: false,
            chunks: ["../other/secret"],
          }),
        },
      ],
    });
    expect(await new FirebaseSaveTransport().list("creator")).toEqual([
      {
        id: "save-one",
        version: "",
        deleted: false,
        chunks: [],
        invalid: true,
      },
    ]);
    expect(getDocFromServer).not.toHaveBeenCalled();
  });

  it("checks cloud versions before replacing or deleting any chunks", async () => {
    documents.set("users/creator/cloudSaves/save-one", {
      version: OLD_VERSION,
      chunks: [BLOB_ID],
    });
    const transport = new FirebaseSaveTransport();
    await expect(
      transport.write("creator", "save-one", undefined, null),
    ).rejects.toBeInstanceOf(CloudConflict);
    expect(commits).toEqual([]);
    expect(documents.get("users/creator/cloudSaves/save-one")?.version).toBe(
      OLD_VERSION,
    );
    const version = await transport.write(
      "creator",
      "save-one",
      OLD_VERSION,
      null,
    );
    expect(version).toMatch(/^[a-f0-9]{32}$/);
    expect(documents.get("users/creator/cloudSaves/save-one")).toEqual({
      version,
      deleted: true,
      chunks: [],
      garbage: [],
    });
    expect(commits[0].every((write) => write.kind !== "delete")).toBe(true);
    expect(commits[1][0]).toEqual({
      path: `saveBlobs/${BLOB_ID}`,
      kind: "delete",
    });
  });

  it("backs up private chunks without expiry or local account bookkeeping", async () => {
    const file = fakeSaveFile();
    const record: SaveRecord = {
      save: file.save,
      metadata: {
        id: "save-one",
        name: file.name,
        status: file.status,
        revision: 4,
        createdAt: file.save.savedAt,
        savedAt: file.save.savedAt,
        scenarioId: 101,
        scenarioName: "Rise of Renewables",
        locationName: "Pittsburgh",
        difficulty: "Employee",
        date: { month: "Jun", year: 2035 },
        cloud: {
          uid: "creator",
          id: "save-one",
          version: OLD_VERSION,
          syncedRevision: 3,
        },
      },
    };
    await new FirebaseSaveTransport().write(
      "creator",
      "save-one",
      undefined,
      record,
    );
    const manifest = documents.get("users/creator/cloudSaves/save-one")!;
    expect(manifest.deleted).toBe(false);
    expect(manifest.metadata).not.toHaveProperty("cloud");
    expect(manifest.metadata).toMatchObject({
      uploadedAt: expect.any(Number),
      uploadedMinute: record.save.game.date.minute,
    });
    // Keep the upload checkpoint inside metadata, allowed by the deployed rules.
    expect(manifest).not.toHaveProperty("uploadedAt");
    expect(manifest).not.toHaveProperty("uploadedMinute");
    (getDocsFromServer as jest.Mock).mockResolvedValue({
      docs: [{ id: "save-one", data: () => manifest }],
    });
    expect(
      (await new FirebaseSaveTransport().list("creator"))[0],
    ).toMatchObject({
      uploadedAt: (manifest.metadata as Record<string, unknown>).uploadedAt,
      uploadedMinute: record.save.game.date.minute,
    });
    const chunks = manifest.chunks as string[];
    expect(documents.get(`saveBlobs/${chunks[0]}`)).toEqual({
      uid: "creator",
      shareId: null,
      expiresAt: null,
      data: JSON.stringify(encodeSaveFile(file)),
    });
  });

  it("retries an interrupted cleanup, including already-deleted chunks", async () => {
    const garbage = Array.from({ length: 12 }, (_, index) =>
      index.toString(16).padStart(32, "0"),
    );
    const path = "users/creator/cloudSaves/save-one";
    documents.set(path, {
      version: OLD_VERSION,
      deleted: true,
      chunks: [],
      garbage,
    });
    for (const id of garbage)
      documents.set(`saveBlobs/${id}`, { uid: "creator", shareId: null });
    const batchFactory = (writeBatch as jest.Mock).getMockImplementation()!;
    (writeBatch as jest.Mock)
      .mockImplementationOnce(batchFactory)
      .mockImplementationOnce(() => ({
        delete: () => undefined,
        commit: async () => {
          throw new Error("connection lost");
        },
      }));
    (getDocsFromServer as jest.Mock).mockImplementation(async () => ({
      docs: [{ id: "save-one", data: () => documents.get(path) }],
    }));
    const transport = new FirebaseSaveTransport();
    await transport.list("creator");
    expect(
      garbage.slice(0, 10).every((id) => !documents.has(`saveBlobs/${id}`)),
    ).toBe(true);
    expect(documents.has(`saveBlobs/${garbage[10]}`)).toBe(true);
    expect(documents.get(path)?.garbage).toEqual(garbage);
    await transport.list("creator");
    expect(garbage.every((id) => !documents.has(`saveBlobs/${id}`))).toBe(true);
    expect(documents.get(path)?.garbage).toEqual([]);
  });

  it("keeps garbage queued by a newer writer while finishing an old cleanup", async () => {
    const path = "users/creator/cloudSaves/save-one";
    documents.set(path, {
      version: OLD_VERSION,
      deleted: true,
      chunks: [],
      garbage: [BLOB_ID],
    });
    (getDocsFromServer as jest.Mock).mockResolvedValue({
      docs: [{ id: "save-one", data: () => documents.get(path) }],
    });
    const newerVersion = "c".repeat(32);
    (writeBatch as jest.Mock).mockImplementationOnce(() => ({
      delete: () => undefined,
      commit: async () => {
        documents.set(path, {
          version: newerVersion,
          deleted: true,
          chunks: [],
          garbage: ["d".repeat(32)],
        });
      },
    }));
    await new FirebaseSaveTransport().list("creator");
    expect(documents.get(path)?.version).toBe(newerVersion);
    expect(documents.get(path)?.garbage).toEqual(["d".repeat(32)]);
  });
});
