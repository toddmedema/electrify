/** Local diagnostics only: SDK calls/deliveries are not a Firestore billing estimate.
 * Enable with ?firestoreReads=1; no identifiers, payloads, persistence or network reporting.
 */
type Source =
  | "leaderboard.rows"
  | "leaderboard.rank"
  | "profile.load"
  | "profile.rename"
  | "save.blob"
  | "save.list"
  | "save.transaction"
  | "save.listener"
  | "share.load"
  | "share.transaction"
  | "achievement.transaction";
type Event = "requests" | "failures" | "documents" | "starts" | "snapshots";
type Counts = Record<Event, number>;
const counters = new Map<Source, Counts>();
const enabled =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("firestoreReads") === "1";

export function recordFirestoreRead(
  source: Source,
  event: Event,
  count = 1,
): void {
  if (!enabled) return;
  const entry = counters.get(source) || {
    requests: 0,
    failures: 0,
    documents: 0,
    starts: 0,
    snapshots: 0,
  };
  entry[event] += count;
  counters.set(source, entry);
}

export async function measureFirestoreRead<T>(
  source: Source,
  read: () => Promise<T>,
  documents: (result: T) => number = () => 0,
): Promise<T> {
  recordFirestoreRead(source, "requests");
  try {
    const result = await read();
    if (enabled) recordFirestoreRead(source, "documents", documents(result));
    return result;
  } catch (error) {
    recordFirestoreRead(source, "failures");
    throw error;
  }
}

declare global {
  interface Window {
    electrifyFirestoreReads?: {
      snapshot(): Partial<Record<Source, Counts>>;
      reset(): void;
    };
  }
}
if (enabled) {
  window.electrifyFirestoreReads = {
    snapshot: () =>
      Object.fromEntries(
        [...counters].map(([source, counts]) => [source, { ...counts }]),
      ),
    reset: () => counters.clear(),
  };
}
