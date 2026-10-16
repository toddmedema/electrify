// Kept separate from domain code so Jest never parses import.meta in its CommonJS runner.
export function createMultiplayerWorker(): Worker {
  return new Worker(
    new URL("../workers/Multiplayer.worker.ts", import.meta.url),
    { type: "module" },
  );
}
