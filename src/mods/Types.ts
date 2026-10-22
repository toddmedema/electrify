import type { ModDiagnostic, ModPackage } from "./ModSchema";
export interface InstalledMod {
  key: string;
  source: "local" | "workshop";
  /** A Workshop download's item, or the item a local package was published as. */
  workshopId?: string;
  enabled: boolean;
  pack: ModPackage;
}
/** Every mod request resolves with this; failures arrive as player-facing `error` text. */
export interface ModLibrary {
  entries: InstalledMod[];
  message?: string;
  /** Partial success, such as one Workshop item skipped during refresh. */
  warning?: string;
  error?: string;
  diagnostics?: ModDiagnostic[];
  /** The library file can't be read; offer a reset. */
  unreadable?: boolean;
  /** A Workshop upload is still running. */
  uploading?: boolean;
  /** The mod a successful import added or replaced. */
  focusKey?: string;
  published?: { workshopId: string; agreement: boolean };
}
export type ModRequest =
  | { kind: "list" | "import" | "template" | "refresh" | "reset" }
  | { kind: "browse"; workshopId?: string }
  | { kind: "subscribe"; id: string }
  | { kind: "remove" | "publish"; key: string }
  | { kind: "enable"; key: string; enabled: boolean };
