let context: AudioContext | null = null;
export function getAudioContext(): AudioContext | null {
  if (context) return context;
  try {
    context = new window.AudioContext();
  } catch {
    console.warn("Web Audio API is not supported in this browser");
  }
  return context;
}
/** Unlock before the first game chunk can consume Safari's user activation. */
export function unlockAudioContext(): void {
  const audio = getAudioContext();
  if (audio && audio.state !== "running" && audio.state !== "closed")
    void audio.resume().catch(() => undefined);
}
