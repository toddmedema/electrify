/** Network ownership lasts for a foreground tenure, rather than one serialized request.
 * Storage leases cover browsers without Web Locks; queued requests survive owner takeover.
 * Neither polling for ownership nor renewing a lease performs a network read.
 */
const LEASE_MS = 25_000;
const HEARTBEAT_MS = 8_000;
interface Lease {
  owner: string;
  expires: number;
}
export class ForegroundSync<T> {
  private id = `${Date.now()}:${Math.random()}`;
  private uid?: string;
  private owned = false;
  private stopped = false;
  private claiming = false;
  private releaseLock?: () => void;
  private timer: ReturnType<typeof setInterval>;
  private memory = new Map<string, T>();
  private persisted = new Set<string>();
  constructor(
    private service: string,
    private changed: (owner: boolean) => void,
    private signal: () => void,
    private validate: (value: unknown) => value is T,
    private status?: (value: unknown) => void,
  ) {
    window.addEventListener("storage", this.storage);
    window.addEventListener("online", this.check);
    window.addEventListener("offline", this.check);
    document.addEventListener("visibilitychange", this.check);
    window.addEventListener("electrify-sync-request", this.storage);
    this.timer = setInterval(this.check, HEARTBEAT_MS);
  }
  private prefix() {
    return `electrify-sync:${this.service}:${this.uid}:`;
  }
  private readLease(): Lease | undefined {
    try {
      return (
        JSON.parse(localStorage.getItem(this.prefix() + "owner") || "null") ||
        undefined
      );
    } catch {
      return undefined;
    }
  }
  private setOwned(value: boolean) {
    if (this.owned === value) return;
    this.owned = value;
    this.changed(value);
  }
  isOwner = () => {
    const lease =
      typeof navigator.locks?.request === "function"
        ? undefined
        : this.readLease();
    return (
      this.owned &&
      !this.stopped &&
      !document.hidden &&
      !!this.uid &&
      navigator.onLine &&
      (!lease || lease.owner === this.id)
    );
  };
  setAccount(uid?: string) {
    if (uid === this.uid) return;
    this.resign();
    this.memory.clear();
    this.persisted.clear();
    this.uid = uid;
    this.check();
    this.status?.(this.readStatus());
  }
  private resign() {
    this.setOwned(false);
    this.releaseLock?.();
    this.releaseLock = undefined;
    if (this.readLease()?.owner === this.id) {
      try {
        localStorage.removeItem(this.prefix() + "owner");
      } catch {
        /* Storage can be disabled. */
      }
    }
  }
  private check = () => {
    if (this.stopped || !this.uid || document.hidden || !navigator.onLine) {
      this.resign();
      return;
    }
    if (navigator.locks?.request) {
      if (this.owned || this.claiming) return;
      this.claiming = true;
      const uid = this.uid;
      void navigator.locks
        .request(
          `electrify-foreground:${this.service}:${uid}`,
          { ifAvailable: true },
          async (lock) => {
            if (
              !lock ||
              this.stopped ||
              uid !== this.uid ||
              document.hidden ||
              !navigator.onLine
            )
              return;
            await new Promise<void>((resolve) => {
              this.releaseLock = resolve;
              this.setOwned(true);
            });
          },
        )
        .catch(() => undefined)
        .finally(() => {
          this.claiming = false;
        });
      return;
    }
    const lease = this.readLease();
    if (lease && lease.owner !== this.id && lease.expires > Date.now()) {
      this.setOwned(false);
      return;
    }
    try {
      localStorage.setItem(
        this.prefix() + "owner",
        JSON.stringify({ owner: this.id, expires: Date.now() + LEASE_MS }),
      );
    } catch {
      // Without storage or Web Locks, retain local work and allow foreground sync to recover.
    }
    // Yield before starting network work so simultaneous lease claims settle first.
    const uid = this.uid;
    void Promise.resolve().then(() => {
      if (
        uid !== this.uid ||
        this.stopped ||
        document.hidden ||
        !navigator.onLine
      )
        return;
      const winner = this.readLease();
      this.setOwned(!winner || winner.owner === this.id);
    });
  };
  private storage = (event: Event) => {
    if (
      event instanceof StorageEvent &&
      event.key &&
      !event.key.startsWith(this.prefix())
    )
      return;
    if (
      event instanceof StorageEvent &&
      event.key === this.prefix() + "status"
    ) {
      if (!this.isOwner()) this.status?.(this.readStatus());
      return;
    }
    this.check();
    if (this.isOwner()) this.signal();
  };
  request(value: T): void {
    const key = this.prefix() + "request:" + Date.now() + ":" + Math.random();
    this.memory.set(key, value);
    try {
      localStorage.setItem(key, JSON.stringify(value));
      this.persisted.add(key);
    } catch {
      /* Memory retains intent. */
    }
    window.dispatchEvent(new Event("electrify-sync-request"));
  }
  pending(): Map<string, T> {
    const messages = new Map(this.memory);
    try {
      for (const key of this.persisted)
        if (localStorage.getItem(key) === null) {
          messages.delete(key);
          this.memory.delete(key);
          this.persisted.delete(key);
        }
      const keys = Array.from({ length: localStorage.length }, (_, index) =>
        localStorage.key(index),
      );
      for (const key of keys) {
        if (key?.startsWith(this.prefix() + "request:")) {
          try {
            const value: unknown = JSON.parse(localStorage.getItem(key)!);
            if (this.validate(value)) messages.set(key, value);
            else localStorage.removeItem(key);
          } catch {
            /* Ignore malformed messages. */
          }
        }
      }
    } catch {
      /* Memory still works if storage is unavailable. */
    }
    return messages;
  }
  private readStatus(): unknown {
    try {
      return JSON.parse(
        localStorage.getItem(this.prefix() + "status") || "null",
      );
    } catch {
      return undefined;
    }
  }
  report(value: unknown) {
    if (this.isOwner()) {
      try {
        localStorage.setItem(this.prefix() + "status", JSON.stringify(value));
      } catch {
        /* UI state remains local. */
      }
    }
  }
  acknowledge(keys: Iterable<string>) {
    for (const key of keys) {
      this.memory.delete(key);
      this.persisted.delete(key);
      try {
        localStorage.removeItem(key);
      } catch {
        /* A later owner can safely repeat the intent. */
      }
    }
  }
  stop() {
    this.stopped = true;
    this.resign();
    clearInterval(this.timer);
    window.removeEventListener("storage", this.storage);
    window.removeEventListener("online", this.check);
    window.removeEventListener("offline", this.check);
    document.removeEventListener("visibilitychange", this.check);
    window.removeEventListener("electrify-sync-request", this.storage);
  }
}
