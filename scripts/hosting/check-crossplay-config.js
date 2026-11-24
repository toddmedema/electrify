const { STEAM_APP_ID: appId = "", COOP_CHECKPOINT_BUCKET: bucket = "" } =
  process.env;

const errors = [];
// Match the App ID range accepted by the Steam package builder and invite page.
if (appId && (!/^[1-9][0-9]{0,9}$/.test(appId) || Number(appId) > 2147483647))
  errors.push("STEAM_APP_ID must be a Steam App ID from 1 to 2147483647.");
if (!/^[a-z0-9][a-z0-9.-]+$/.test(bucket))
  errors.push(
    "COOP_CHECKPOINT_BUCKET must be the private checkpoint bucket name.",
  );
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}
