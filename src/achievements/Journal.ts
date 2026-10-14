import { emptyRecord, mergeRecords, validRecord } from "./Progress";
import type { AchievementRecord } from "./Progress";

export const ACHIEVEMENT_STORAGE_KEY = "electrify-achievements-v1";
export type AchievementSyncState =
  "local" | "syncing" | "synced" | "offline" | "failed";
interface DeviceJournal {
  version: 1;
  guest: AchievementRecord;
  accounts: Record<string, AchievementRecord>;
}
export interface AchievementSnapshot {
  progress: AchievementRecord;
  uid?: string;
  sync: AchievementSyncState;
  storageAvailable: boolean;
  steamAvailable: boolean;
  notifications: string[];
}
type DeviceStorage = Pick<Storage, "getItem" | "setItem">;
const emptyDevice = (): DeviceJournal => ({
  version: 1,
  guest: emptyRecord(),
  accounts: {},
});
function readDevice(storage: DeviceStorage): DeviceJournal {
  const raw = storage.getItem(ACHIEVEMENT_STORAGE_KEY);
  if (!raw) return emptyDevice();
  if (raw.length > 2_000_000) throw new Error("Achievement journal too large");
  const value = JSON.parse(raw) as DeviceJournal;
  if (
    !value ||
    value.version !== 1 ||
    !validRecord(value.guest) ||
    !value.accounts ||
    typeof value.accounts !== "object" ||
    Array.isArray(value.accounts) ||
    Object.keys(value.accounts).length > 1000 ||
    !Object.entries(value.accounts).every(
      ([uid, record]) =>
        uid.length > 0 && uid.length <= 200 && validRecord(record),
    )
  )
    throw new Error("Invalid achievement journal");
  return value;
}

/** One atomic device record transfers guest progress without leaking it to a later account. */
export class AchievementJournal {
  private root = emptyDevice();
  private listeners = new Set<() => void>();
  private dirty = false;
  private guestClaimPending = false;
  private snapshot: AchievementSnapshot = {
    progress: emptyRecord(),
    sync: "local",
    storageAvailable: true,
    steamAvailable: false,
    notifications: [],
  };
  constructor(
    private storage: () => DeviceStorage = () => window.localStorage,
  ) {
    try {
      this.root = readDevice(storage());
      this.snapshot = {
        ...this.snapshot,
        progress: mergeRecords(this.root.guest),
      };
    } catch {
      this.snapshot = { ...this.snapshot, storageAvailable: false };
    }
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<AchievementSnapshot>) {
    const next = { ...this.snapshot, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
  private persist() {
    try {
      this.storage().setItem(
        ACHIEVEMENT_STORAGE_KEY,
        JSON.stringify(this.root),
      );
      this.dirty = false;
      this.guestClaimPending = false;
      this.publish({ storageAvailable: true });
    } catch {
      this.dirty = true;
      this.publish({ storageAvailable: false });
    }
  }
  /** Refresh before writes and on storage events so sequential tabs cannot erase each other. */
  refresh() {
    try {
      const next = readDevice(this.storage());
      if (this.dirty) {
        let accounts = { ...next.accounts };
        for (const [uid, record] of Object.entries(this.root.accounts))
          accounts = {
            ...accounts,
            [uid]: mergeRecords(
              Object.prototype.hasOwnProperty.call(accounts, uid)
                ? accounts[uid]
                : emptyRecord(),
              record,
            ),
          };
        this.root = {
          version: 1,
          guest: this.guestClaimPending
            ? this.root.guest
            : mergeRecords(next.guest, this.root.guest),
          accounts,
        };
      } else this.root = next;
      const uid = this.snapshot.uid;
      this.publish({
        progress: mergeRecords(
          uid && Object.prototype.hasOwnProperty.call(this.root.accounts, uid)
            ? this.root.accounts[uid]
            : uid
              ? emptyRecord()
              : this.root.guest,
        ),
      });
    } catch {
      this.publish({ storageAvailable: false });
    }
  }
  retryStorage() {
    if (this.dirty) {
      this.refresh();
      this.persist();
    }
  }
  activate(uid?: string) {
    if (uid === this.snapshot.uid) return;
    this.refresh();
    if (uid) {
      this.guestClaimPending = true;
      this.root = {
        ...this.root,
        guest: emptyRecord(),
        accounts: {
          ...this.root.accounts,
          [uid]: mergeRecords(
            Object.prototype.hasOwnProperty.call(this.root.accounts, uid)
              ? this.root.accounts[uid]
              : emptyRecord(),
            this.root.guest,
          ),
        },
      };
      this.persist();
    }
    this.publish({
      uid,
      progress: uid ? this.root.accounts[uid] : this.root.guest,
      sync: "local",
      notifications: [],
    });
  }
  merge(record: AchievementRecord, notify = false): string[] {
    this.refresh();
    const progress = mergeRecords(this.snapshot.progress, record);
    const unlocked = progress.earned.filter(
      (id) => !this.snapshot.progress.earned.includes(id),
    );
    if (JSON.stringify(progress) === JSON.stringify(this.snapshot.progress))
      return [];
    const uid = this.snapshot.uid;
    this.root = uid
      ? { ...this.root, accounts: { ...this.root.accounts, [uid]: progress } }
      : { ...this.root, guest: progress };
    this.persist();
    this.publish({
      progress,
      notifications:
        notify && !this.snapshot.steamAvailable
          ? [...this.snapshot.notifications, ...unlocked]
          : this.snapshot.notifications,
    });
    return unlocked;
  }
  setSync(sync: AchievementSyncState) {
    this.publish({ sync });
  }
  setSteamAvailable(steamAvailable: boolean) {
    this.publish({
      steamAvailable,
      ...(steamAvailable ? { notifications: [] } : {}),
    });
  }
  dismiss(id: string) {
    this.publish({
      notifications: this.snapshot.notifications.filter((item) => item !== id),
    });
  }
  clearNotifications() {
    this.publish({ notifications: [] });
  }
}
export const achievementJournal = new AchievementJournal();
