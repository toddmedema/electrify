// The desktop save owner coordinates checkpoints for both exit and system sleep.
export type DesktopCheckpointReason = "quit" | "suspend";
const checkpoints = new Set<
  (reason: DesktopCheckpointReason) => Promise<void>
>();
export function registerShutdownCheckpoint(
  checkpoint: (reason: DesktopCheckpointReason) => Promise<void>,
): () => void {
  checkpoints.add(checkpoint);
  return () => {
    checkpoints.delete(checkpoint);
  };
}
export async function flushShutdownCheckpoints(
  reason: DesktopCheckpointReason = "quit",
): Promise<void> {
  await Promise.all([...checkpoints].map((checkpoint) => checkpoint(reason)));
}
