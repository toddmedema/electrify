import "fake-indexeddb/auto";
import { deserialize, serialize } from "v8";
import { webcrypto } from "crypto";
import { DesktopBridge } from "./Desktop";
import {
  DesktopCloudRecord,
  DesktopSaveLibrary,
  DesktopSaveTransport,
  mergeDesktopLibraries,
  parseDesktopLibrary,
} from "./DesktopSaveTransport";
import { SaveRepository } from "./SaveRepository";
import { parseSave, serializeSave } from "./SaveGame";
import { encodeSaveFile } from "./SaveFile";
import { fakeSaveGame } from "./testing/SaveTestHelpers";

if (typeof structuredClone === "undefined")
  Object.defineProperty(globalThis, "structuredClone", {
    configurable: true,
    value: <T>(value: T): T => deserialize(serialize(value)),
  });
Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  value: webcrypto,
});
const id = "a".repeat(32);
const v1 = "1".repeat(32);
const v2 = "2".repeat(32);
const v3 = "3".repeat(32);

function nativeBridge(local: DesktopSaveLibrary | null = null) {
  return {
    readSaveLibrary: jest.fn().mockResolvedValue({
      local,
      cloud: null,
      cloudCopies: [],
      cloudState: "ready",
    }),
    writeSaveLibrary: jest.fn().mockResolvedValue({ cloudState: "ready" }),
  } as unknown as DesktopBridge;
}
const repositories: SaveRepository[] = [];
function repository(): SaveRepository {
  const result = new SaveRepository(parseSave, {
    databaseName: `desktop-test-${Math.random()}`,
  });
  repositories.push(result);
  return result;
}
afterEach(() => {
  repositories.splice(0).forEach((entry) => entry.close());
});
async function cloudRecord(
  version = v1,
  ancestors: string[] = [],
): Promise<DesktopCloudRecord> {
  const record = await repository().create({
    id,
    name: "My game",
    scenarioName: "Game",
    save: serializeSave(fakeSaveGame()),
  });
  return {
    head: {
      id,
      version,
      ancestors,
      deleted: false,
      chunks: [],
      metadata: record.metadata,
    },
    file: encodeSaveFile({
      name: record.metadata.name,
      status: record.metadata.status,
      save: record.save,
    }),
  };
}
function library(records: DesktopCloudRecord[]): DesktopSaveLibrary {
  return { version: 1, records };
}

it("keeps both divergent device versions under stable identities, and ignores causal ancestors", async () => {
  const first = await cloudRecord(v1);
  const second = {
    ...first,
    head: { ...first.head, version: v2, ancestors: [v1] },
    file: { different: true },
  };
  const third = {
    ...first,
    head: { ...first.head, version: v3, ancestors: [v1] },
    file: { third: true },
  };
  const merged = mergeDesktopLibraries([
    library([first]),
    library([second]),
    library([third]),
  ]);
  expect(merged.map((entry) => entry.head.id).sort()).toEqual([id, v2].sort());
  const retried = mergeDesktopLibraries([
    library(merged),
    library([first]),
    library([second]),
    library([third]),
  ]);
  expect(retried.map((entry) => entry.head.id).sort()).toEqual([id, v2].sort());
});

it("unions losing branches' ancestry so stale replicas cannot resurrect on the next merge", async () => {
  const original = await cloudRecord(v1);
  const two = {
    ...original,
    head: { ...original.head, version: v2, ancestors: [v1] },
  };
  const three = {
    ...original,
    head: { ...original.head, version: v3, ancestors: [v1] },
  };
  const four = {
    ...original,
    head: { ...original.head, version: "4".repeat(32), ancestors: [v1, v2] },
    file: { four: true },
  };
  const five = {
    ...original,
    head: { ...original.head, version: "5".repeat(32), ancestors: [v1, v3] },
    file: { five: true },
  };
  const merged = mergeDesktopLibraries([library([four]), library([five])]);
  expect(merged.find((entry) => entry.head.id === id)?.head.ancestors).toEqual(
    expect.arrayContaining([v1, v2, v3, "4".repeat(32)]),
  );
  expect(
    mergeDesktopLibraries([library(merged), library([two]), library([three])]),
  ).toHaveLength(2);
});

it("keeps a deletion as the original identity while retaining concurrent progress as a branch", async () => {
  const original = await cloudRecord(v2, [v1]);
  const deletion = {
    head: { id, version: v3, ancestors: [v1], deleted: true, chunks: [] },
  };
  const merged = mergeDesktopLibraries([
    library([original]),
    library([deletion]),
  ]);
  expect(merged.find((entry) => entry.head.id === id)?.head.deleted).toBe(true);
  expect(merged.find((entry) => entry.head.id === v2)?.file).toEqual(
    original.file,
  );
});

it("rejects malformed cloud metadata before reconciliation", async () => {
  const record = await cloudRecord();
  expect(() =>
    parseDesktopLibrary(
      library([{ ...record, head: { ...record.head, metadata: undefined } }]),
    ),
  ).toThrow("metadata");
  expect(() => parseDesktopLibrary(library([record, record]))).toThrow(
    "invalid",
  );
});

it("restores the complete prior record after failed cloud writes", async () => {
  const original = await cloudRecord();
  const native = nativeBridge(library([original]));
  const transport = new DesktopSaveTransport(native, repository());
  const [head] = await transport.list("steam:1");
  const before = await transport.read(head);
  const changed = {
    ...before,
    metadata: { ...before.metadata, name: "New name" },
  };
  (native.writeSaveLibrary as jest.Mock).mockResolvedValue({
    cloudState: "failed",
  });
  await expect(transport.write("steam:1", id, v1, changed)).rejects.toThrow(
    "couldn't finish",
  );
  expect(await transport.read(head)).toEqual(before);
  (native.writeSaveLibrary as jest.Mock).mockRejectedValue(
    new Error("Disk full"),
  );
  await expect(transport.write("steam:1", id, v1, changed)).rejects.toThrow(
    "Disk full",
  );
  expect(await transport.read(head)).toEqual(before);
});

it("recovers a missing device database and preserves newer progress in an existing one", async () => {
  const source = repository();
  await source.create({
    id,
    name: "Old name",
    scenarioName: "Game",
    save: serializeSave(fakeSaveGame()),
  });
  const backup = await source.backup();
  const restored = repository();
  await restored.restoreBackup(backup);
  expect((await restored.read(id)).metadata.name).toBe("Old name");
  await restored.rename(id, "New name");
  await restored.restoreBackup(backup);
  expect((await restored.read(id)).metadata.name).toBe("New name");
});

it("does not resurrect the last deleted save from a stale desktop mirror", async () => {
  const source = repository();
  await source.create({
    id,
    name: "Game",
    scenarioName: "Game",
    save: serializeSave(fakeSaveGame()),
  });
  const backup = await source.backup();
  await source.markDesktopInitialized();
  await source.delete(id);
  await source.restoreBackup(backup);
  expect(await source.list()).toEqual([]);
});

it("recovers a crashed desktop writer immediately without changing its saved progress", async () => {
  const source = repository();
  const created = await source.create({
    id,
    name: "My game",
    scenarioName: "Game",
    save: serializeSave(fakeSaveGame()),
    writerToken: "previous-process",
  });
  await expect(source.prepareResume(id, "new-process")).rejects.toMatchObject({
    code: "conflict",
  });
  await source.recoverDesktopWriterLeases();
  const resumed = await source.prepareResume(id, "new-process");
  expect(resumed.record).toEqual(created);
  expect(resumed.lease.writerToken).toBe("new-process");
});

it("captures offline checkpoints causally and retains pending deletion tombstones", async () => {
  const source = repository();
  await source.create({
    id,
    name: "Game",
    scenarioName: "Game",
    save: serializeSave(fakeSaveGame()),
  });
  const transport = new DesktopSaveTransport(nativeBridge(), source);
  await transport.captureDevice("steam:1");
  const first = (await transport.library()).records[0].head;
  await source.rename(id, "Renamed");
  await transport.captureDevice("steam:1");
  const second = (await transport.library()).records[0].head;
  expect(second.ancestors).toContain(first.version);
  await source.delete(id);
  await transport.captureDevice("steam:1");
  expect((await transport.library()).records[0].head.deleted).toBe(true);
});

it("restores damaged saves for recovery and checkpoints the readable ones", async () => {
  const source = repository();
  const damagedId = "b".repeat(32);
  for (const saveId of [id, damagedId])
    await source.create({
      id: saveId,
      name: "Game",
      scenarioName: "Game",
      save: serializeSave(fakeSaveGame()),
    });
  const backup = await source.backup();
  backup.payloads = backup.payloads.map((payload) =>
    payload.id === damagedId
      ? { ...payload, save: { damaged: true } }
      : payload,
  );
  const restored = repository();
  await restored.restoreBackup(backup);
  expect((await restored.list()).map((entry) => entry.id).sort()).toEqual(
    [id, damagedId].sort(),
  );
  await expect(restored.read(damagedId)).rejects.toThrow();
  const transport = new DesktopSaveTransport(nativeBridge(), restored);
  await transport.captureDevice("steam:1");
  expect(
    (await transport.library()).records.map((entry) => entry.head.id),
  ).toEqual([id]);
});
