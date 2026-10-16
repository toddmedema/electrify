// Participants join the existing single desktop quit handshake; only its owner calls readyToQuit.
const checkpoints = new Set<() => Promise<void>>();
export function registerShutdownCheckpoint(
  checkpoint: () => Promise<void>,
): () => void {
  checkpoints.add(checkpoint);
  return () => {
    checkpoints.delete(checkpoint);
  };
}
export async function flushShutdownCheckpoints(): Promise<void> {
  await Promise.all([...checkpoints].map((checkpoint) => checkpoint()));
}
