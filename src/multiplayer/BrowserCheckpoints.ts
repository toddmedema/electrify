import { getScenario } from "../data/Scenarios";
import type { CheckpointStore, SharedSaveLibrary } from "./SessionTransport";
import type { World } from "./Types";

type Checkpoint = SharedSaveLibrary["slots"][number] & {
  world: World;
};

const STORE = "campaigns";
const MAX_SAVES = 32;

export function browserCheckpoints(): CheckpointStore {
  async function transaction<Result>(
    mode: IDBTransactionMode,
    handle: (store: IDBObjectStore, result: (value: Result) => void) => void,
  ): Promise<Result> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("electrify-crossplay", 1);
      request.onupgradeneeded = () => {
        request.result
          .createObjectStore(STORE, { keyPath: "id" })
          .createIndex("updatedAt", "updatedAt");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Result>((resolve, reject) => {
        const session = database.transaction(STORE, mode);
        let result: Result;
        session.oncomplete = () => resolve(result);
        session.onabort = () =>
          reject(
            session.error ?? new Error("Could not access multiplayer saves."),
          );
        handle(session.objectStore(STORE), (value) => {
          result = value;
        });
      });
    } finally {
      database.close();
    }
  }

  function list() {
    return transaction<SharedSaveLibrary>("readonly", (store, set) => {
      const slots: SharedSaveLibrary["slots"] = [];
      const cursor = store.index("updatedAt").openCursor(null, "prev");
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return set({ slots, cloudState: "disabled" });
        const { world: _, ...entry }: Checkpoint = row.value;
        slots.push(entry);
        row.continue();
      };
    });
  }

  return {
    read(id) {
      return transaction<World | null>("readonly", (store, set) => {
        if (id) {
          const request = store.get(id);
          request.onsuccess = () =>
            set((request.result as Checkpoint | undefined)?.world ?? null);
        } else {
          const request = store.index("updatedAt").openCursor(null, "prev");
          request.onsuccess = () =>
            set(
              (request.result?.value as Checkpoint | undefined)?.world ?? null,
            );
        }
      });
    },
    list,
    async remove(id) {
      await transaction<void>("readwrite", (store) => {
        store.delete(id);
      });
      return list();
    },
    write(world) {
      return transaction<void>("readwrite", (store) => {
        const write = store.put({
          id: world.matchId,
          name:
            getScenario(world.spec.scenarioId, world.spec.customScenario)
              ?.name ?? "Multiplayer campaign",
          matchId: world.matchId,
          updatedAt: Date.now(),
          schema: world.schema,
          players: world.seats.map((seat) => seat.name),
          world,
        } satisfies Checkpoint);
        write.onsuccess = () => {
          const cursor = store.index("updatedAt").openCursor(null, "prev");
          let retained = 0;
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (!row) return;
            if (++retained > MAX_SAVES) row.delete();
            row.continue();
          };
        };
      });
    },
  };
}
