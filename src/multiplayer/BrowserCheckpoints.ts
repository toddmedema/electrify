import { getScenario } from "../data/Scenarios";
import type { CheckpointStore, SharedSaveLibrary } from "./SessionTransport";
import type { World } from "./Types";

type Slot = SharedSaveLibrary["slots"][number];
type Checkpoint = Slot & { epoch: string; revision: number };

const CAMPAIGNS = "campaigns";
const WORLDS = "worlds";
const MAX_SAVES = 32;

export function browserCheckpoints(namespace?: string): CheckpointStore {
  async function transaction<Result>(
    mode: IDBTransactionMode,
    handle: (
      campaigns: IDBObjectStore,
      worlds: IDBObjectStore,
      result: (value: Result) => void,
      fail: (error: Error) => void,
    ) => void,
  ): Promise<Result> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(
        namespace ? `electrify-coop-v2-${namespace}` : "electrify-crossplay",
        1,
      );
      request.onupgradeneeded = () => {
        request.result
          .createObjectStore(CAMPAIGNS, { keyPath: "id" })
          .createIndex("updatedAt", "updatedAt");
        request.result.createObjectStore(WORLDS, { keyPath: "matchId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Result>((resolve, reject) => {
        const session = database.transaction([CAMPAIGNS, WORLDS], mode);
        let result: Result;
        let failure: Error | undefined;
        session.oncomplete = () => resolve(result);
        session.onabort = () =>
          reject(
            failure ??
              session.error ??
              new Error("Could not access multiplayer saves."),
          );
        handle(
          session.objectStore(CAMPAIGNS),
          session.objectStore(WORLDS),
          (value) => {
            result = value;
          },
          (error) => {
            failure = error;
            session.abort();
          },
        );
      });
    } finally {
      database.close();
    }
  }

  function list() {
    return transaction<SharedSaveLibrary>("readonly", (campaigns, _, set) => {
      const slots: Slot[] = [];
      const cursor = campaigns.index("updatedAt").openCursor(null, "prev");
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return set({ slots, cloudState: "disabled" });
        const { epoch: _, revision: __, ...slot }: Checkpoint = row.value;
        slots.push(slot);
        row.continue();
      };
    });
  }

  return {
    read(id) {
      return transaction<World | null>("readonly", (campaigns, worlds, set) => {
        const readWorld = (matchId: string) => {
          const request = worlds.get(matchId);
          request.onsuccess = () =>
            set((request.result as World | undefined) ?? null);
        };
        if (id) readWorld(id);
        else {
          const request = campaigns
            .index("updatedAt")
            .openKeyCursor(null, "prev");
          request.onsuccess = () => {
            const match = request.result;
            if (match) readWorld(String(match.primaryKey));
            else set(null);
          };
        }
      });
    },
    list,
    async remove(id) {
      await transaction<void>("readwrite", (campaigns, worlds) => {
        campaigns.delete(id);
        worlds.delete(id);
      });
      return list();
    },
    write(world, source) {
      return transaction<void>("readwrite", (campaigns, worlds, _, fail) => {
        const current = campaigns.get(world.matchId);
        current.onsuccess = () => {
          const previous = current.result as Checkpoint | undefined;
          if (
            previous?.epoch === world.epoch &&
            previous.revision > world.revision
          )
            return;
          // A continuation can replace the checkpoint it started from while that version is current.
          if (
            previous &&
            previous.epoch !== world.epoch &&
            (source?.matchId !== previous.matchId ||
              source.epoch !== previous.epoch ||
              source.revision !== previous.revision)
          ) {
            fail(new Error("This campaign has a newer save in another tab."));
            return;
          }
          const scenarioName = getScenario(
            world.spec.scenarioId,
            world.spec.customScenario,
          )?.name;
          campaigns.put({
            id: world.matchId,
            name: scenarioName?.slice(0, 80).trim() || "Multiplayer campaign",
            matchId: world.matchId,
            updatedAt: Date.now(),
            schema: world.schema,
            players: world.seats.map((seat) => seat.name),
            epoch: world.epoch,
            revision: world.revision,
          } satisfies Checkpoint);
          worlds.put(world);
          const cursor = campaigns
            .index("updatedAt")
            .openKeyCursor(null, "prev");
          // Reserve a slot for this save even if the system clock moved backwards.
          let retained = 1;
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (!row) return;
            if (row.primaryKey !== world.matchId && ++retained > MAX_SAVES) {
              campaigns.delete(row.primaryKey);
              worlds.delete(row.primaryKey);
            }
            row.continue();
          };
        };
      });
    },
  };
}
