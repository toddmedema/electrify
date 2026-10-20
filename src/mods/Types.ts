import type { ModPackage } from "../data/ModSchema";
export interface InstalledMod {
  key: string;
  source: "local" | "workshop";
  workshopId?: string;
  enabled: boolean;
  pack: ModPackage;
}
export interface ModLibrary {
  entries: InstalledMod[];
  message?: string;
}
export type ModRequest =
  | { kind: "template"; rules: string }
  | { kind: "list" | "import" | "refresh" }
  | { kind: "subscribe"; id: string }
  | { kind: "remove" | "publish"; key: string }
  | { kind: "enable"; key: string; enabled: boolean };
