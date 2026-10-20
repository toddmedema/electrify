const fs = require("node:fs");
const path = require("node:path");
const { parseMod, MAX_MOD_BYTES } = require("../src/data/ModSchema.js");
const { atomicWrite } = require("./storage.cjs");
const { itemId } = require("./steam-workshop.cjs");
const MAX_PACKAGES = 32;
const initializedDirectories = new Set();
function readPackage(filename) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MOD_BYTES)
    throw new Error("Expected a data-only JSON package under 256 KiB.");
  return parseMod(fs.readFileSync(filename, "utf8"));
}
class ModStore {
  constructor(directory, workshop = () => null, rules) {
    this.directory = path.join(directory, "mods");
    this.filename = path.join(this.directory, "library.json");
    this.workshop = workshop;
    this.rules = rules;
    this.pending = Promise.resolve();
    // Steam uploads belong to this process. Clean leftovers only on the first
    // store opened after launch, never when a window is recreated mid-upload.
    if (!initializedDirectories.has(this.directory)) {
      if (fs.existsSync(this.directory))
        for (const name of fs.readdirSync(this.directory))
          if (/^upload-[a-zA-Z0-9]+$/.test(name))
            fs.rmSync(path.join(this.directory, name), {
              recursive: true,
              force: true,
            });
      initializedDirectories.add(this.directory);
    }
  }
  read() {
    if (
      !fs.existsSync(this.filename) &&
      !fs.existsSync(`${this.filename}.previous`)
    )
      return [];
    try {
      return this.readFile(this.filename);
    } catch {
      try {
        return this.readFile(`${this.filename}.previous`);
      } catch {
        throw new Error(
          "Mod library could not be read. Its files have been preserved.",
        );
      }
    }
  }
  readFile(filename) {
    if (fs.statSync(filename).size > MAX_PACKAGES * (MAX_MOD_BYTES + 1024))
      throw new Error("Mod library exceeds its size limit.");
    const entries = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (!Array.isArray(entries) || entries.length > MAX_PACKAGES)
      throw new Error("Invalid mod library.");
    for (const entry of entries) {
      entry.pack = parseMod(JSON.stringify(entry.pack));
      if (
        typeof entry.enabled !== "boolean" ||
        !["local", "workshop"].includes(entry.source)
      )
        throw new Error("Invalid mod entry.");
      if (entry.workshopId) itemId(entry.workshopId);
    }
    return entries;
  }
  write(entries) {
    if (entries.length > MAX_PACKAGES)
      throw new Error("Mod management supports at most 32 installed packages.");
    atomicWrite(this.filename, JSON.stringify(entries));
  }
  request(input, chooseFile, chooseSave) {
    const operation = this.pending.then(() =>
      this.perform(input, chooseFile, chooseSave),
    );
    this.pending = operation.catch(() => {});
    return operation;
  }
  async perform(input, chooseFile, chooseSave) {
    if (!input || typeof input !== "object")
      throw new Error("Invalid mod request.");
    let entries = this.read();
    let message;
    const find = () => {
      const entry = entries.find((e) => e.key === input.key);
      if (!entry) throw new Error("Installed mod not found.");
      return entry;
    };
    const online = () => {
      const workshop = this.workshop();
      if (!workshop)
        throw new Error(
          "Connect to Steam to use Workshop. Local mods remain available.",
        );
      return workshop;
    };
    switch (input.kind) {
      case "list":
        break;
      case "template": {
        const pack = parseMod(
          JSON.stringify({
            schemaVersion: 1,
            id: "my-grid",
            title: "My Grid",
            creator: "Your name",
            version: "1.0.0",
            rules: input.rules,
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
          }),
        );
        const filename = await chooseSave();
        if (filename)
          fs.writeFileSync(filename, JSON.stringify(pack, null, 2) + "\n", {
            mode: 0o600,
          });
        break;
      }
      case "import": {
        const filename = await chooseFile();
        if (!filename) break;
        const pack = readPackage(filename);
        const key = `local:${pack.id}`;
        const previous = entries.find((e) => e.key === key);
        entries = entries.filter((e) => e.key !== key);
        entries.push({
          key,
          source: "local",
          enabled: previous?.enabled ?? true,
          pack,
          ...(previous?.workshopId ? { workshopId: previous.workshopId } : {}),
        });
        this.write(entries);
        break;
      }
      case "enable": {
        if (typeof input.enabled !== "boolean")
          throw new Error("Invalid enabled state.");
        find().enabled = input.enabled;
        this.write(entries);
        break;
      }
      case "remove": {
        const entry = find();
        if (entry.source === "workshop")
          await online().subscription(entry.workshopId, false);
        entries = entries.filter((e) => e !== entry);
        this.write(entries);
        break;
      }
      case "subscribe": {
        itemId(input.id);
        await online().subscription(input.id, true);
        message =
          "Subscribed. Use Refresh downloads after Steam finishes downloading.";
        break;
      }
      case "refresh": {
        const workshop = online();
        const subscribed = workshop.subscribed();
        if (subscribed.length > MAX_PACKAGES)
          throw new Error(
            "Reduce Workshop subscriptions to 32 before refreshing.",
          );
        const next = entries.filter(
          (e) => e.source !== "workshop" || subscribed.includes(e.workshopId),
        );
        for (const id of subscribed) {
          itemId(id);
          const info = workshop.installed(id);
          if (!info) continue;
          // Packages may reference only game-bundled assets; no archives, scripts or loose media.
          if (
            fs.lstatSync(info.folder).isSymbolicLink() ||
            BigInt(info.sizeOnDisk) > BigInt(MAX_MOD_BYTES) ||
            fs.readdirSync(info.folder).join(",") !== "scenario.json"
          )
            throw new Error(
              `Workshop item ${id} is not a data-only scenario package.`,
            );
          const pack = readPackage(path.join(info.folder, "scenario.json"));
          const key = `workshop:${id}`;
          const index = next.findIndex((e) => e.key === key);
          const entry = {
            key,
            source: "workshop",
            workshopId: id,
            enabled: index < 0 ? true : next[index].enabled,
            pack,
          };
          if (index < 0) next.push(entry);
          else next[index] = entry;
        }
        this.write(next);
        entries = next;
        message =
          "Installed downloads refreshed. Existing saves keep their original content.";
        break;
      }
      case "publish": {
        const entry = find();
        if (entry.source !== "local")
          throw new Error("Only your local packages can be published.");
        if (!this.rules || entry.pack.rules !== this.rules)
          throw new Error(
            "This package does not match the installed game rules.",
          );
        const workshop = online();
        fs.mkdirSync(this.directory, { recursive: true });
        if (
          fs
            .readdirSync(this.directory)
            .filter((name) => /^upload-[a-zA-Z0-9]+$/.test(name)).length >=
          MAX_PACKAGES
        )
          throw new Error(
            "Too many unfinished uploads. Restart Electrify before publishing again.",
          );
        let agreement = false;
        if (!entry.workshopId) {
          const created = await workshop.create();
          entry.workshopId = created.id;
          agreement = created.agreement;
          // Persist creation before uploading so retrying a failed upload updates the same item.
          this.write(entries);
        }
        fs.mkdirSync(this.directory, { recursive: true });
        const stage = fs.mkdtempSync(path.join(this.directory, "upload-"));
        fs.writeFileSync(
          path.join(stage, "scenario.json"),
          JSON.stringify(entry.pack),
        );
        // An expired callback or disconnected client does not cancel Steam's upload.
        // Leave the source intact on failure until the next app launch.
        const result = await workshop.publish(
          entry.workshopId,
          entry.pack,
          stage,
        );
        agreement ||= result.agreement;
        fs.rmSync(stage, { recursive: true, force: true });
        message = `Public Workshop item ${entry.workshopId} uploaded.${agreement ? " Accept the Steam Workshop legal agreement on Steam before sharing." : ""}`;
        break;
      }
      default:
        throw new Error("Unknown mod action.");
    }
    return { entries, message };
  }
}
module.exports = { ModStore, readPackage };
