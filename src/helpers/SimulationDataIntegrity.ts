import manifest from "../data/RunCompatibility.json";

/** Check the bytes actually consumed, including responses from the offline cache. */
export function simulationDataRequest(url: string): RequestInit {
  const integrity = (manifest.dataIntegrity as Record<string, string>)[url];
  return integrity ? { integrity } : {};
}
