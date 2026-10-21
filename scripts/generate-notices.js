const fs = require("node:fs");
const path = require("node:path");
const { prepareElectronRuntime } = require("./prepare-electron-runtime");

const NOTICE_NAME = /^(?:licen[cs]e|copying|copyright|notice)(?:[._-].*)?$/i;

function readNotices(directory, prefix = "") {
  return fs
    .readdirSync(path.join(directory, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const name = path.posix.join(prefix, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") {
        const nested = readNotices(directory, name);
        return nested ? [nested] : [];
      }
      return entry.isFile() && NOTICE_NAME.test(entry.name)
        ? [
            `${name}\n\n${fs.readFileSync(path.join(directory, name), "utf8").trim()}`,
          ]
        : [];
    })
    .sort()
    .join("\n\n");
}

function firebaseHeaders(directory) {
  const headers = new Set();
  function visit(current) {
    for (const file of fs.readdirSync(current, { withFileTypes: true })) {
      if (file.name === "node_modules") continue;
      const name = path.join(current, file.name);
      if (file.isDirectory()) visit(name);
      else if (/\.(?:c|m)?js$/.test(file.name)) {
        const source = fs.readFileSync(name, "utf8");
        for (const [comment] of source.matchAll(/\/\*[\s\S]*?\*\//g))
          if (/@license|copyright/i.test(comment)) headers.add(comment);
      }
    }
  }
  visit(directory);
  return [...headers].sort().join("\n\n");
}

/** Use the installed, locked packages, so notices match the actual release. */
function collectNotices(root) {
  const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
  const lock = JSON.parse(read("package-lock.json"));
  const notices = [
    {
      title: "Electrify — MIT License with Commons Clause",
      text: read("LICENSE.md"),
    },
    ...JSON.parse(read("legal/asset-notices.json")).map(
      ({ title, text, file }) => ({
        title,
        text: file ? `${text}\n\n${read(file)}` : text,
      }),
    ),
  ];
  for (const [name, entry] of Object.entries(lock.packages).sort(([a], [b]) =>
    a.localeCompare(b, "en"),
  )) {
    if (!name || entry.dev || entry.devOptional) continue;
    const directory = path.join(root, name);
    if (!fs.existsSync(directory)) {
      // npm installs only the current platform's optional native slices.
      if (entry.optional && (entry.os || entry.cpu)) continue;
      throw new Error(
        `Install the lockfile before generating notices: ${name}`,
      );
    }
    const manifest = JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf8"),
    );
    if (manifest.version !== entry.version)
      throw new Error(
        `Installed notice version differs from lockfile: ${name}`,
      );
    // All Koffi slices share the parent project's MIT/vendor notice. Group
    // them there so a shared renderer built on Linux also credits Mac/Windows.
    if (/^@koromix\/koffi-/.test(manifest.name) && manifest.license === "MIT")
      continue;
    let text = readNotices(directory);
    if (
      !text &&
      /^(?:firebase|@firebase\/)/.test(manifest.name) &&
      manifest.license === "Apache-2.0"
    )
      text = `${read("legal/firebase-LICENSE.txt")}\n\n${firebaseHeaders(directory)}`;
    if (!text) {
      const readme = fs
        .readdirSync(directory)
        .find((file) => /^readme(?:\.md|\.txt)?$/i.test(file));
      const contents = readme
        ? fs.readFileSync(path.join(directory, readme), "utf8")
        : "";
      const section = contents.match(
        /^#{1,3}\s+(?:license|copyright)[^\n]*\n[\s\S]*$/im,
      );
      if (section) text = section[0];
    }
    if (!text)
      throw new Error(
        `No redistribution notice found for ${name}; review upstream before shipping`,
      );
    if (manifest.name === "koffi") {
      const slices = Object.entries(lock.packages).filter(([name]) =>
        /^node_modules\/@koromix\/koffi-/.test(name),
      );
      if (slices.some(([, entry]) => entry.version !== manifest.version))
        throw new Error(
          "Koffi native slice versions differ from their parent notice",
        );
      text = `This notice also covers all locked @koromix/koffi-* native binary slices at version ${manifest.version}, including the Windows, Linux and both macOS architectures.\n\n${text}`;
    }
    notices.push({
      title: `${manifest.name} ${manifest.version} (${manifest.license || "see notice"})`,
      text,
    });
  }
  return notices.filter(
    (notice, index) =>
      notices.findIndex(
        (entry) => entry.title === notice.title && entry.text === notice.text,
      ) === index,
  );
}

function generateNotices(
  root = path.resolve(__dirname, ".."),
  desktop = false,
) {
  const notices = collectNotices(root);
  const publicRoot = path.join(root, "public");
  if (desktop) {
    const { directory: runtime, version } = prepareElectronRuntime(root);
    notices.push({
      title: `Electron runtime ${version}`,
      text: readNotices(runtime),
    });
    fs.copyFileSync(
      path.join(runtime, "LICENSES.chromium.html"),
      path.join(publicRoot, "notices-chromium.html"),
    );
  } else {
    fs.rmSync(path.join(publicRoot, "notices-chromium.html"), { force: true });
  }
  fs.writeFileSync(
    path.join(publicRoot, "notices.json"),
    JSON.stringify({ notices, chromium: desktop }) + "\n",
  );
  return notices;
}

if (require.main === module)
  generateNotices(undefined, process.argv.includes("--desktop"));
module.exports = { collectNotices, generateNotices };
