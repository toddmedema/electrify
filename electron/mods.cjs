const fs = require("node:fs");
const path = require("node:path");
const {
  parseMod,
  validateMod,
  MAX_MOD_BYTES,
  MOD_API_VERSION,
  ModValidationError,
} = require("../src/mods/ModSchema.js");
const { atomicWriteAsync } = require("./storage.cjs");
const { itemId } = require("./steam-workshop.cjs");
const MAX_PACKAGES = 32;
const STAGE = /^upload-[a-zA-Z0-9]+$/;
const OFFLINE = "Workshop needs Steam. Local mods still work offline.";

class LibraryUnreadableError extends Error {}
const reason = (error) =>
  error instanceof Error ? error.message : "Something went wrong.";
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

async function readPackage(filename) {
  const stat = await fs.promises.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MOD_BYTES)
    throw new Error("Choose a scenario.json file under 256 KiB.");
  return parseMod(await fs.promises.readFile(filename, "utf8"));
}

/** Rebuilds one persisted entry from known fields only. */
function libraryEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid mod entry.");
  const pack = validateMod(value.pack);
  if (typeof value.enabled !== "boolean") throw new Error("Invalid mod entry.");
  if (value.source === "local") {
    if (value.key !== `local:${pack.id}`) throw new Error("Invalid mod entry.");
    return { key: value.key, source: "local", enabled: value.enabled, pack };
  }
  if (value.source === "workshop") {
    itemId(value.workshopId);
    if (value.key !== `workshop:${value.workshopId}`)
      throw new Error("Invalid mod entry.");
    return {
      key: value.key,
      source: "workshop",
      workshopId: value.workshopId,
      enabled: value.enabled,
      pack,
    };
  }
  throw new Error("Invalid mod entry.");
}

/**
 * The installed mod library. Each library write is atomic and keeps the previous copy, so a
 * failed or partial change never replaces the last good library. Mutations are serialized;
 * listing reads the last completed write and never waits behind a long upload.
 */
class ModStore {
  constructor(directory, options = {}) {
    this.directory = path.join(directory, "mods");
    this.filename = path.join(this.directory, "library.json");
    this.workshop = options.workshop || (() => null);
    this.chooseFile = options.chooseFile || (async () => undefined);
    this.chooseSave = options.chooseSave || (async () => undefined);
    this.openUrl = options.openUrl || (() => {});
    this.appId = options.appId;
    this.pending = Promise.resolve();
    this.uploading = false;
  }

  /**
   * Removes upload stages left by an earlier session. Run once at launch: Steam may still be
   * reading a stage from this session. Failure is logged and never blocks startup.
   */
  async cleanupStages() {
    try {
      const names = await fs.promises.readdir(this.directory);
      await Promise.all(
        names
          .filter((name) => STAGE.test(name))
          .map((name) =>
            fs.promises.rm(path.join(this.directory, name), {
              recursive: true,
              force: true,
            }),
          ),
      );
      return true;
    } catch (error) {
      if (error && error.code === "ENOENT") return true;
      console.warn("Could not clean up old mod uploads", error);
      return false;
    }
  }

  async exists(filename) {
    try {
      await fs.promises.access(filename);
      return true;
    } catch {
      return false;
    }
  }

  async readFile(filename) {
    const stat = await fs.promises.stat(filename);
    if (stat.size > MAX_PACKAGES * (MAX_MOD_BYTES + 1024) + 64 * 1024)
      throw new Error("Mod library exceeds its size limit.");
    const data = JSON.parse(await fs.promises.readFile(filename, "utf8"));
    // Version 1 libraries were a bare list of entries.
    const library = Array.isArray(data)
      ? { entries: data, published: {} }
      : data;
    if (
      !library ||
      typeof library !== "object" ||
      !Array.isArray(library.entries) ||
      library.entries.length > MAX_PACKAGES
    )
      throw new Error("Invalid mod library.");
    const entries = library.entries.map(libraryEntry);
    if (new Set(entries.map((entry) => entry.key)).size !== entries.length)
      throw new Error("Invalid mod library.");
    const published = {};
    const records = library.published ?? {};
    if (!records || typeof records !== "object" || Array.isArray(records))
      throw new Error("Invalid mod library.");
    for (const [id, record] of Object.entries(records)) {
      if (
        !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(id) ||
        !record ||
        typeof record !== "object" ||
        typeof record.uploaded !== "boolean"
      )
        throw new Error("Invalid mod library.");
      itemId(record.workshopId);
      published[id] = {
        workshopId: record.workshopId,
        uploaded: record.uploaded,
      };
    }
    return { entries, published };
  }

  async read() {
    if (
      !(await this.exists(this.filename)) &&
      !(await this.exists(`${this.filename}.previous`))
    )
      return { entries: [], published: {} };
    try {
      return await this.readFile(this.filename);
    } catch {
      try {
        return await this.readFile(`${this.filename}.previous`);
      } catch {
        throw new LibraryUnreadableError(
          "Your mod library couldn't be read. Reset it to start over; the old files are kept.",
        );
      }
    }
  }

  async write(library) {
    if (library.entries.length > MAX_PACKAGES)
      throw new Error(
        `Electrify can install at most ${MAX_PACKAGES} mods. Remove one first.`,
      );
    await atomicWriteAsync(
      this.filename,
      JSON.stringify({
        version: 2,
        entries: library.entries,
        published: library.published,
      }),
    );
  }

  /** What the renderer sees: local packages carry their published Workshop item, if any. */
  view(library) {
    return library.entries.map((entry) =>
      entry.source === "local" && library.published[entry.pack.id]
        ? { ...entry, workshopId: library.published[entry.pack.id].workshopId }
        : entry,
    );
  }

  /** Never rejects: failures come back as player-facing `error` text with a fresh list. */
  async request(input) {
    if (input?.kind === "list") return this.respond(() => ({}));
    const operation = this.pending.then(() =>
      this.respond(() => this.perform(input)),
    );
    this.pending = operation;
    return operation;
  }

  async respond(action) {
    let result;
    let failure;
    try {
      result = await action();
    } catch (error) {
      failure = error;
    }
    try {
      const library = await this.read();
      return {
        ...result,
        entries: this.view(library),
        uploading: this.uploading,
        ...(failure
          ? {
              error: reason(failure),
              ...(failure instanceof ModValidationError
                ? { diagnostics: failure.diagnostics }
                : {}),
            }
          : {}),
      };
    } catch (error) {
      return {
        entries: [],
        uploading: this.uploading,
        error: reason(failure || error),
        unreadable: error instanceof LibraryUnreadableError,
      };
    }
  }

  online() {
    const workshop = this.workshop();
    if (!workshop) throw new Error(OFFLINE);
    return workshop;
  }

  async perform(input) {
    if (!input || typeof input !== "object")
      throw new Error("Invalid mod request.");
    switch (input.kind) {
      case "reset":
        return this.reset();
      case "browse":
        return this.browse(input);
      case "template":
        return this.template();
      default:
        break;
    }
    const library = await this.read();
    const find = () => {
      const entry = library.entries.find((e) => e.key === input.key);
      if (!entry) throw new Error("That mod is no longer installed.");
      return entry;
    };
    switch (input.kind) {
      case "import": {
        const filename = await this.chooseFile();
        if (!filename) return {};
        const pack = await readPackage(filename);
        const key = `local:${pack.id}`;
        const previous = library.entries.find((e) => e.key === key);
        library.entries = library.entries.filter((e) => e.key !== key);
        library.entries.push({
          key,
          source: "local",
          enabled: previous?.enabled ?? true,
          pack,
        });
        await this.write(library);
        return {
          message: `${previous ? "Updated" : "Imported"} ${pack.title}.`,
          focusKey: key,
        };
      }
      case "enable": {
        if (typeof input.enabled !== "boolean")
          throw new Error("Invalid enabled state.");
        find().enabled = input.enabled;
        await this.write(library);
        return {};
      }
      case "remove": {
        const entry = find();
        if (entry.source === "workshop")
          await this.online().subscription(entry.workshopId, false);
        // The published-item record stays, so reinstalling and publishing updates the same item.
        library.entries = library.entries.filter((e) => e !== entry);
        await this.write(library);
        return { message: `Removed ${entry.pack.title}.` };
      }
      case "subscribe": {
        itemId(input.id);
        await this.online().subscription(input.id, true);
        return {
          ...(await this.refresh(library)),
          message:
            "Subscribed. The mod appears here when Steam finishes downloading it.",
        };
      }
      case "refresh":
        return this.refresh(library);
      case "publish":
        return this.publish(library, find());
      default:
        throw new Error("Unknown mod action.");
    }
  }

  async reset() {
    const stamp = new Date().toISOString().replace(/[^0-9]/g, "");
    for (const filename of [this.filename, `${this.filename}.previous`])
      if (await this.exists(filename))
        await fs.promises.rename(
          filename,
          `${filename.replace(/\.json(\.previous)?$/, "")}-unreadable-${stamp}${filename.endsWith(".previous") ? "-previous" : ""}.json`,
        );
    await this.write({ entries: [], published: {} });
    return {
      message:
        "Mod library reset. The unreadable files were kept in the mods folder.",
    };
  }

  browse(input) {
    if (input.workshopId !== undefined) itemId(input.workshopId);
    else if (!this.appId) throw new Error(OFFLINE);
    const url =
      input.workshopId !== undefined
        ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${input.workshopId}`
        : `https://steamcommunity.com/app/${this.appId}/workshop/`;
    this.openUrl(url);
    return {};
  }

  async template() {
    const pack = validateMod({
      schemaVersion: 1,
      gameApi: MOD_API_VERSION,
      id: "my-grid",
      title: "My Grid",
      creator: "Your name",
      version: "1.0.0",
      seed: 42,
      baseScenarioId: 999,
      scenario: { durationMonths: 240, eventScenarioIds: [100] },
      facilities: { Solar: { buildCost: 0.8 } },
      programs: { efficiency: 0.8 },
      notifications: [
        {
          month: 12,
          title: "First year",
          message: "Review your grid before the next year.",
        },
      ],
    });
    const filename = await this.chooseSave();
    if (!filename) return {};
    await fs.promises.writeFile(
      filename,
      JSON.stringify(pack, null, 2) + "\n",
      { mode: 0o600 },
    );
    return { message: "Template saved. Edit it, then choose Import mod." };
  }

  async refresh(library) {
    const workshop = this.online();
    const subscribed = workshop.subscribed();
    const before = library.entries;
    const next = before.filter(
      (e) => e.source !== "workshop" || subscribed.includes(e.workshopId),
    );
    const removed = before.length - next.length;
    let added = 0;
    let updated = 0;
    let downloading = 0;
    let overLimit = 0;
    const skipped = [];
    for (const id of subscribed) {
      const key = `workshop:${id}`;
      const index = next.findIndex((e) => e.key === key);
      if (index < 0 && next.length >= MAX_PACKAGES) {
        overLimit++;
        continue;
      }
      try {
        itemId(id);
        const info = workshop.installedOrQueueDownload(id);
        if (!info) {
          downloading++;
          continue;
        }
        // Packages may reference only game-bundled assets; no archives, scripts or loose media.
        const folder = await fs.promises.lstat(info.folder);
        if (
          folder.isSymbolicLink() ||
          !folder.isDirectory() ||
          BigInt(info.sizeOnDisk) > BigInt(MAX_MOD_BYTES) ||
          (await fs.promises.readdir(info.folder)).join(",") !== "scenario.json"
        )
          throw new Error("not a data-only scenario package.");
        const pack = await readPackage(path.join(info.folder, "scenario.json"));
        const entry = {
          key,
          source: "workshop",
          workshopId: id,
          enabled: index < 0 ? true : next[index].enabled,
          pack,
        };
        if (index < 0) {
          next.push(entry);
          added++;
        } else {
          if (JSON.stringify(next[index].pack) !== JSON.stringify(pack))
            updated++;
          next[index] = entry;
        }
      } catch (error) {
        // Keep the last good copy of this item, if any, and carry on with the rest.
        skipped.push(`Skipped Workshop item ${id}: ${reason(error)}`);
      }
    }
    library.entries = next;
    if (added || updated || removed) await this.write(library);
    const parts = [];
    if (added) parts.push(`Installed ${plural(added, "mod")}.`);
    if (updated) parts.push(`Updated ${plural(updated, "mod")}.`);
    if (removed) parts.push(`Removed ${plural(removed, "unsubscribed mod")}.`);
    if (downloading)
      parts.push(
        `${plural(downloading, "mod")} still downloading. They appear when Steam finishes.`,
      );
    if (!parts.length && !skipped.length && !overLimit)
      parts.push("Workshop mods are up to date.");
    if (overLimit)
      skipped.push(
        `Electrify can install ${MAX_PACKAGES} mods, so ${plural(overLimit, "subscription")} ${overLimit === 1 ? "wasn't" : "weren't"} installed. Unsubscribe from some on Steam, then refresh.`,
      );
    return {
      ...(parts.length ? { message: parts.join(" ") } : {}),
      ...(skipped.length ? { warning: skipped.join(" ") } : {}),
    };
  }

  async publish(library, entry) {
    if (entry.source !== "local")
      throw new Error("Only your own local mods can be published.");
    if (entry.pack.gameApi !== MOD_API_VERSION)
      throw new Error(
        "Update this mod for the current game version before publishing.",
      );
    const workshop = this.online();
    await fs.promises.mkdir(this.directory, { recursive: true });
    const stages = (await fs.promises.readdir(this.directory)).filter((name) =>
      STAGE.test(name),
    );
    if (stages.length >= MAX_PACKAGES)
      throw new Error(
        "Too many unfinished uploads. Restart Electrify before publishing again.",
      );
    let record = library.published[entry.pack.id];
    let agreement = false;
    if (!record) {
      const created = await workshop.create();
      record = { workshopId: created.id, uploaded: false };
      library.published[entry.pack.id] = record;
      agreement = created.agreement;
      // Persist creation before uploading so retrying a failed upload updates the same item.
      await this.write(library);
    }
    const stage = await fs.promises.mkdtemp(
      path.join(this.directory, "upload-"),
    );
    await fs.promises.writeFile(
      path.join(stage, "scenario.json"),
      JSON.stringify(entry.pack),
    );
    // An expired callback or disconnected client does not cancel Steam's upload.
    // Leave the stage intact on failure until the next app launch.
    this.uploading = true;
    let result;
    try {
      result = await workshop.publish(record.workshopId, entry.pack, stage, {
        setVisibility: !record.uploaded,
      });
    } finally {
      this.uploading = false;
    }
    agreement ||= result.agreement;
    record.uploaded = true;
    await this.write(library);
    await fs.promises.rm(stage, { recursive: true, force: true });
    return {
      message: agreement
        ? "Uploaded, but hidden until you accept the Steam Workshop agreement."
        : "Published to Steam Workshop.",
      published: { workshopId: record.workshopId, agreement },
    };
  }
}
module.exports = { ModStore, readPackage, MAX_PACKAGES };
