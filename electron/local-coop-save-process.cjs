const { LocalCoopSaveStore } = require("./local-coop-storage.cjs");
const codec = require("./coop-codec.cjs");

/** The utility process alone validates, encodes and writes this profile's library. */
function serveLocalCoopSaves(port, directory, ownerId) {
  const store = new LocalCoopSaveStore(directory, ownerId, codec);
  port.on("message", async ({ data: { id, kind, argument } }) => {
    try {
      let result;
      switch (kind) {
        case "list-saves":
          result = await store.list();
          break;
        case "read-save":
          result = await store.select(argument);
          break;
        case "write-save":
          result = await store.save(argument);
          break;
        case "delete-save":
          result = await store.remove(argument);
          break;
        default:
          throw new Error("Unknown local couch save request");
      }
      port.postMessage({ id, result });
    } catch (error) {
      port.postMessage({ id, error: error.message });
    }
  });
}

if (process.parentPort)
  serveLocalCoopSaves(process.parentPort, process.argv[2], process.argv[3]);

module.exports = { serveLocalCoopSaves };
