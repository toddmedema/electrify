// A deliberately conservative build contract: changed simulation inputs invalidate old
// invitations instead of silently running them against different rules or data.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const output = "src/data/RunCompatibility.json";
const rulesRevision = 1;

function filesUnder(directory) {
  return fs
    .readdirSync(path.join(root, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const relative = `${directory}/${entry.name}`;
      return entry.isDirectory() ? filesUnder(relative) : [relative];
    });
}

const sourceFiles = ["src/data", "src/helpers", "src/reducers"]
  .flatMap(filesUnder)
  .filter((file) => /\.(tsx?|json)$/.test(file))
  .filter((file) => !/\.(test|spec)\./.test(file) && file !== output);
const dataFiles = filesUnder("public/data").filter((file) =>
  /\.(bin|csv|json)$/.test(file),
);
const inputs = [
  "src/Constants.tsx",
  "src/Types.tsx",
  "package-lock.json",
  ...sourceFiles,
  ...dataFiles,
].sort();
const digest = crypto.createHash("sha256");
const dataIntegrity = {};
digest.update(`electrify-rules:${rulesRevision}\n`);
for (const file of inputs) {
  const raw = fs.readFileSync(path.join(root, file));
  if (
    raw
      .subarray(0, 80)
      .toString()
      .startsWith("version https://git-lfs.github.com/spec/")
  ) {
    throw new Error(
      `Fetch the actual input before generating compatibility: ${file}`,
    );
  }
  // Git checkouts on different platforms must produce the same content identity.
  const content = file.endsWith(".bin")
    ? raw
    : Buffer.from(raw.toString("utf8").replace(/\r\n/g, "\n"));
  const inputDigest = crypto.createHash("sha256").update(content).digest("hex");
  digest.update(`${file}\0${inputDigest}\n`);
  if (file.startsWith("public/data/")) {
    // Integrity checks consume raw HTTP bytes, so shipped text must have the
    // same LF line endings enforced by .gitattributes on every build platform.
    if (!file.endsWith(".bin") && !raw.equals(content)) {
      throw new Error(`Normalize shipped data to LF before building: ${file}`);
    }
    dataIntegrity[file.slice("public".length)] =
      `sha256-${Buffer.from(inputDigest, "hex").toString("base64")}`;
  }
}
const manifest = {
  rulesRevision,
  compatibilityId: `rules-${rulesRevision}-${digest.digest("hex")}`,
  dataIntegrity,
};
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
const destination = path.join(root, output);
if (process.argv.includes("--check")) {
  const actual = fs.existsSync(destination)
    ? fs.readFileSync(destination, "utf8").replace(/\r\n/g, "\n")
    : "";
  if (actual !== serialized) {
    console.error(
      "Run compatibility is stale. Run npm run compatibility:generate and commit the updated manifest.",
    );
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(destination, serialized);
}
