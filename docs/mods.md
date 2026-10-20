# Scenarios, mods and Steam Workshop

Desktop players open **New Game → Community scenarios** or **Settings → Mods → Manage mods**
to play, import, browse, update and remove data-only scenario mods. Local packages and
installed Workshop content work offline, including when Steam is not running. The mod
library belongs to the local app profile rather than a Steam login. Browser builds do not
include mod support.

**Save authoring template** writes a `scenario.json` to edit in a text editor; **Import mod**
installs it. The creator name is supplied by the author, not verified. Publishing asks for
confirmation before uploading publicly, and later uploads of that package update the same
Workshop item, even after removing and re-importing it. A new item becomes public on its
first upload; later updates keep whatever visibility the creator chose on Steam. Steam may
require its Workshop legal agreement before the item becomes visible.

## Package format

Version 1 accepts one UTF-8 `scenario.json`, at most 256 KiB, with no other files.
There are no executable scripts, external URLs, HTML, archives or custom media. Scenario
icons, weather and other assets come from the desktop edition's bundled offline assets.
A package cannot overwrite engine files or change the authored catalog.

Required fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `1` |
| `gameApi` | The mod contract version the package targets. This release supports `1`. |
| `id` | 1–64 lowercase letters, digits or hyphens; starts and ends with a letter or digit |
| `title` | Plain text, at most 100 characters and 128 bytes of UTF-8 (Steam's title limit) |
| `creator` | Plain text, at most 100 characters |
| `version` | Creator version, at most 40 characters |
| `seed` | Integer from 0 through 4294967295 |
| `baseScenarioId` | A scenario ID from the table below, or `999` for the default custom grid |

Text fields reject control characters, zero-width characters and text-direction overrides.

Optional `scenario` overrides support `cash` (0–1 trillion), `startingYear` (1980–2100),
`startingCustomers` (1–100 million), `startingDemandScale` (0.01–100), `dollarsPerkWh`
(0–100), `durationMonths` (6–1200), `feePerKgCO2e` (0–100), `ownership` (`Investor` or
`Public`), and `endTitle` / `endMessage` (500 characters each). Integer fields require
integers. Starting cash, tariff and carbon fee that the package does not set follow the
chosen starting year, as on the custom game screen. `eventScenarioIds` selects up to 20
distinct event arcs from the table below, including their notifications and choices. It
defaults to the base scenario's arc, or none for a custom base. The year range applies to
the resolved scenario too.

| ID | Scenario | ID | Scenario |
| --- | --- | --- | --- |
| 100 | Carbon Fee | 107 | Deep Freeze |
| 101 | Rise of Renewables | 108 | Heatwave + Drought |
| 102 | The End of an Era | 110 | Sudden Nuclear Shutdown |
| 103 | The Shale Boom | 111 | Wildfire Emergency |
| 104 | Hurricane Season | 113 | Load Shedding |
| 105 | Paradise | 114 | The River Runs Dry |
| 106 | Data Center Boom | 115 | Delhi Summer |

`facilities` maps facility names to any of `buildCost`, `annualOperatingCost` and
`yearsToBuild`. Values multiply the normal catalog calculation and must be 0.1–10. For
example, `"facilities": {"Solar": {"buildCost": 0.8}}` makes solar 20% cheaper to build.
The names are `Coal`, `Nuclear`, `Natural Gas Peaker`, `Natural Gas CC`, `Oil`, `Biomass`,
`Wind`, `Offshore Wind`, `Airborne Wind`, `Solar`, `Hydro`, `Geothermal`,
`Enhanced Geothermal`, `Battery` and `Pumped Hydro`. Modifiers apply to the starting fleet,
every later purchase and forecast quotes in that run. They do not add new facilities.

`programs` maps `efficiency` (Efficiency rebates) and/or `solar` (Rooftop solar rebates) to
cost multipliers from 0.1–10. Operating tariffs, new programs and engine code are not
supported by this data-only format. `startingDemandScale` calibrates demand for the run.

`notifications` contains at most 100 `{month, title, message}` entries. The month counts
from the start of the run and must fall within the resolved scenario's duration; title is
at most 100 characters and message at most 500. Each is recorded once when the run reaches
that month.

Unknown fields, unsupported versions and invalid values are rejected, including nested
unknown fields. Errors name the field and how to fix it, for example
`facilities.Solr is not a supported facility. Use one of: Coal, …`.

## Compatibility

Packages are checked against `gameApi`, not against a particular game build, so ordinary
updates never break installed mods. The contract version changes only when the game removes
or renames something packages rely on, such as a facility or scenario, or changes what a
modifier means. A package written for another contract version stays visible but cannot
start or publish; the mod screen asks the player to get an update from its creator.

## Lifecycle

At most 32 mods may be installed. Importing a package with the same `id` replaces the
installed version and keeps its enabled state. Workshop copies are keyed by Steam item ID.
With Steam running, opening the mod screen copies finished Workshop downloads into
Electrify's local library and removes items unsubscribed on Steam; **Check for updates**
does the same on demand. Each item is validated on its own: a malformed or partial download
is skipped with a message and never replaces that item's last good copy, while the other
items still install. Updates never change a game in progress.

Disabled mods stay installed but cannot be played. Unsubscribing asks for confirmation and
needs Steam; offline players can disable the mod instead. A run keeps the mod's resolved
scenario and its modifiers, not the package, so updating, disabling or removing a mod never
changes existing saves, and later contract changes cannot make those saves unreadable.

Modded runs use custom scenario ID 999, show **Modded · Unranked** while playing, and are
excluded from leaderboards, official replays and achievements. Co-op cannot launch mods; the
co-op protocol covers the authored catalog and custom setup only.

Steam references: [Workshop implementation](https://partner.steamgames.com/doc/features/workshop/implementation)
and [ISteamUGC](https://partner.steamgames.com/doc/api/ISteamUGC).
