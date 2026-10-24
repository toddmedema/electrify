# Releases and web services

See the [contributor guide](../CONTRIBUTING.md) for development checks and the
[desktop and Steam guide](desktop-steam.md) for desktop distribution.

## Web releases

To release, install and authenticate the AWS CLI.

Merging to `master` deploys prod through GitHub Actions (`.github/workflows/deploy-prod.yml`).
To preview a change first, run `npm run deploy beta` and check that:

- basic functionality works (app loads, game starts, music plays)

Web and desktop builds use their build-start timestamp as the version, for example
`v26sept26-1507` in Settings and `26sept26-1507` in metadata. The timestamp uses fixed PST
(UTC−8, including summer), a two-digit day/year, and 24-hour time. Settings and the deployed
`/package.json` report the same version.
Game analytics events include it as `app_version`; new scores, personal bests, replays, and saves
use `appVersion`. Steam scores store the ASCII version in zero-padded int32 score-detail slots.
Existing records keep their original metadata. The development server stamps its start time;
unbuilt test/CLI entry points use `dev`. Electron's required semver package field stays separate
from its `appVersion` metadata and is not used by the game UI or logging. Build timestamps do not
change the simulation compatibility hash.

## Display-name storage

Player names live in `users/{uid}.displayName`. Display names are not unique;
Firebase Auth UIDs identify accounts. Scores retain a display-name copy for efficient
leaderboard reads, with best-effort backfilling when a player renames themselves.
