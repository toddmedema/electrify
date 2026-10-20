# Scenarios, mods and Steam Workshop

Desktop players can open **Settings → Mods and Workshop** to import a local package,
subscribe by Workshop item ID, refresh completed downloads, enable or remove a package,
and launch a modded scenario. Local packages and installed Workshop content work offline, including when Steam is not running.
The mod library belongs to the local app profile rather than a Steam login.
Browser builds do not expose native Workshop or filesystem capabilities.

Use **Save authoring template** to create a JSON file with the current rules fingerprint.
Edit it in a text editor and import it. The creator name is supplied by the author, not
verified identity. **Publish to Workshop** asks for confirmation before uploading publicly.
Subsequent uploads of that local package update the same Workshop item. Steam checks item
ownership. A failed upload retains the item ID so retry does not create duplicates.
Steam may require its legal agreement before the item becomes visible.

## Package format

Version 1 accepts one UTF-8 `scenario.json`, at most 256 KiB, with no other files.
There are no executable scripts, external URLs, HTML, archives, or custom media. Scenario
icons, weather and other assets come from the desktop edition's bundled offline assets.
The package cannot overwrite engine files or change the global authored catalog.

Required fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `1` |
| `id` | 1–64 lowercase letters, digits or hyphens; starts with a letter or digit |
| `title`, `creator` | Plain text, at most 100 characters each |
| `version` | Creator version, at most 40 characters |
| `rules` | Exact `rules-…` fingerprint from the exported template |
| `seed` | Integer from 0 through 4294967295 |
| `baseScenarioId` | Non-tutorial built-in scenario ID, or `999` for the default custom grid |

Optional `scenario` overrides support `cash` (0–1 trillion), `startingYear` (1980–2100),
`startingCustomers` (1–100 million), `startingDemandScale` (0.01–100), `dollarsPerkWh`
(0–100), `durationMonths` (6–1200), `feePerKgCO2e` (0–100), `ownership` (`Investor` or
`Public`), and `endTitle` / `endMessage` (500 characters each). Integer fields require
integers. `eventScenarioIds` selects up to 20 distinct existing non-tutorial event arcs,
including their notifications and choices. It defaults to the base scenario's arc, or
none for a custom base. The year range applies to the resolved scenario too.

`facilities` maps existing facility names to any of `buildCost`, `annualOperatingCost`,
and `yearsToBuild`. Values multiply the normal catalog calculation and must be 0.1–10.
For example, `"facilities": {"Solar": {"buildCost": 0.8}}` discounts solar construction
by 20%. Both generators and storage are supported. These modifiers also apply to future
purchases and forecast quotes in that run. They do not add new facility identities.

`programs` maps `efficiency` and/or `solar` to cost multipliers from 0.1–10. Operating
tariffs, arbitrary program identities, and replacement engine code are not supported by
this data-only format. `startingDemandScale` provides a run-wide demand calibration.

`notifications` contains at most 100 `{month, title, message}` entries. The month is a
1–1200 integer counted from the start of the run; title is at most 100 characters and
message at most 500. Each is recorded once when the run reaches that month.

Unknown fields, unsupported versions and invalid values are rejected, including nested
unknown fields. A structurally valid package with a different rules fingerprint stays
visible in management but cannot start or publish until its author updates it. Changing
the fingerprint is an author assertion: test the content against that game version first.

## Lifecycle and compatibility

At most 32 packages may be installed. Importing the same local `id` replaces its installed
version and preserves enabled state. Workshop copies are keyed by Steam item ID.
**Refresh downloads** copies complete validated content into Electrify's local library;
partial or malformed downloads never replace the previous installed library. Refresh also
removes copies of items unsubscribed through Steam. A pending download keeps the last good
copy until the next refresh. Refresh is explicit; updates never occur mid-run.

Disable prevents new launches. Unsubscribe-and-remove requires Steam confirmation before
removing the local installed entry; offline users can disable it immediately. Existing
saves embed the complete resolved scenario and its modifier package. Updating, disabling,
or removing an installation does not change those saves. Normal game save upgrades still
apply when the engine changes.

All modded scenarios use custom scenario ID 999 and are excluded from official ranked
boards and achievements. They cannot export an official replay: the current replay format
does not carry custom scenario content. Co-op launching is disabled for mods; the current
co-op protocol is designed for the authored catalog and custom setup, not Workshop packages.

## Release verification

Automated coverage includes hostile schema input, size limits, local persistence,
transactional updates, unsubscribe failures, publishing retries, native callback packing,
run-local facility and program changes, save validation, and headless desktop management
in light/dark layouts. Native operations use the existing sole Steam manual dispatcher.
They never start a second Rust callback pump.

Before advertising Steam Workshop availability, configure Workshop for the production
App ID in Steamworks and complete a private-branch acceptance run with two real accounts:
publish and accept the legal agreement; subscribe and download; launch offline after
restarting; publish an update and refresh it; disable/unsubscribe; resume an older save;
verify public item visibility and ownership rejection. Exercise keyboard/controller and
Steam Deck/Proton on hardware. These checks need Steam credentials and cannot be proven by
mocked SDK responses. Local mod management is available in public desktop builds even if
Steam is unavailable. The Workshop path reports connection or API failures in the UI.

Steam references: [Workshop implementation](https://partner.steamgames.com/doc/features/workshop/implementation)
and [ISteamUGC](https://partner.steamgames.com/doc/api/ISteamUGC).
