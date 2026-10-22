import type { ModDiagnostic, ModPackage } from "./ModSchema";
export interface InstalledMod {
  key: string;
  source: "local" | "workshop";
  /** A Workshop download's item, or the item a local package was published as. */
  workshopId?: string;
  enabled: boolean;
  pack: ModPackage;
}
export interface QuarantinedMod {
  key: string;
  title: string;
  creator: string;
  version: string;
  /** Recovery data only. Never compiled, enabled, or published. */
  original: string;
  originalTruncated?: boolean;
  diagnostic: string;
}
export interface ModImportConflict {
  token: string;
  existing: Pick<ModPackage, "id" | "title" | "creator" | "version">;
  incoming: Pick<ModPackage, "id" | "title" | "creator" | "version">;
}
export interface ModDownload {
  id: string;
  status: "queued" | "downloading" | "skipped";
  message?: string;
}
/** Every mod request resolves with this; failures arrive as player-facing `error` text. */
export interface ModLibrary {
  entries: InstalledMod[];
  quarantined?: QuarantinedMod[];
  recovered?: boolean;
  agreements?: string[];
  downloads?: ModDownload[];
  importConflict?: ModImportConflict;
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
  | { kind: "dismissAgreement"; workshopId: string }
  | { kind: "discard"; key: string }
  | {
      kind: "resolveImport";
      token: string;
      action: "update" | "copy" | "cancel";
    }
  | { kind: "remove"; key: string }
  | {
      kind: "publish";
      key: string;
      packageDigest: string;
      rulesDescription: string;
    }
  | { kind: "enable"; key: string; enabled: boolean };
