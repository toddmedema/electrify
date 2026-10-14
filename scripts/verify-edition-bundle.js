const fs = require("node:fs");
const path = require("node:path");

/** Gate the executable output, including lazy chunks, rather than trusting an env flag. */
function verifyEditionBundle(root = "build", edition = "web") {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "asset-manifest.json"), "utf8"),
  );
  const scripts = Object.values(manifest.files).filter((name) =>
    /\.js$/.test(name),
  );
  const contents = scripts
    .map((name) =>
      fs.readFileSync(path.join(root, name.replace(/^\//, "")), "utf8"),
    )
    .join("\n");
  const includesAchievements = [
    "MASTER_OF_THE_GRID",
    "NIGHT_SHIFT",
    "GRID_GRADUATE",
  ].some((id) => contents.includes(id));
  const hasElectronChunk = scripts.some((name) =>
    /(?:^|\/)electron\.[^/]+\.chunk\.js$/.test(name),
  );
  const hasSteamBridge = contents.includes("submitAchievements");
  if (!includesAchievements)
    throw new Error("The shared achievement catalog is missing");
  if (edition === "web" && (hasSteamBridge || hasElectronChunk))
    throw new Error("Electron Steam code leaked into the web build");
  if (edition === "desktop" && (!hasSteamBridge || !hasElectronChunk))
    throw new Error(
      "The Electron service chunk or Steam achievement bridge is missing",
    );
  console.error(
    `${edition} bundle isolation verified (${scripts.length} scripts).`,
  );
}
if (require.main === module)
  verifyEditionBundle(process.argv[3] || "build", process.argv[2] || "web");
module.exports = { verifyEditionBundle };
