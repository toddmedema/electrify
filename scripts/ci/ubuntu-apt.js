const fs = require("node:fs");
const path = require("node:path");

function configureUbuntuApt(directory = "/etc/apt") {
  const parts = path.join(directory, "sources.list.d");
  const sources = [
    path.join(directory, "sources.list"),
    ...fs
      .readdirSync(parts)
      .filter((name) => /\.(list|sources)$/.test(name))
      .map((name) => path.join(parts, name)),
  ].filter((file) => fs.existsSync(file));
  // The hosted image uses this mirror list, with Azure first. Select Ubuntu directly
  // instead of retaining the failing mirror transport (including its fallback state).
  // https://github.com/actions/runner-images/blob/ubuntu22/20261101.347/images/ubuntu/scripts/build/configure-apt-sources.sh
  const entries = sources.map((file) => {
    const original = fs.readFileSync(file, "utf8");
    return {
      file,
      original,
      contents: original.replace(
        /(^|\s)(?:mirror\+file:\/etc\/apt\/apt-mirrors\.txt|https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu)\/?(?=\s|$)/gm,
        "$1https://archive.ubuntu.com/ubuntu/",
      ),
    };
  });
  if (
    !entries.some(({ contents }) =>
      /https?:\/\/(?:archive|security)\.ubuntu\.com\/ubuntu\/?(?=\s|$)/m.test(
        contents,
      ),
    )
  )
    throw new Error(
      "No supported Ubuntu apt source found; inspect the runner image",
    );
  for (const { file, original, contents } of entries)
    if (contents !== original) fs.writeFileSync(file, contents);
  // Playwright invokes apt itself, so configure the root-owned apt defaults once.
  // Error-Mode rejects stale indexes even when apt-get update would only warn.
  fs.writeFileSync(
    path.join(directory, "apt.conf.d", "99electrify-ci"),
    'Acquire::Retries "3";\n' +
      'Acquire::http::Timeout "30";\n' +
      'Acquire::https::Timeout "30";\n' +
      'APT::Update::Error-Mode "any";\n',
  );
}

if (require.main === module) configureUbuntuApt();

module.exports = { configureUbuntuApt };
