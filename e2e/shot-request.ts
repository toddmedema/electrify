/**
 * The request that `npm run shot` (scripts/dev/shot.js) hands to the Playwright runner. The
 * script owns parsing and validation; this file only describes and reads its result.
 */
export interface ShotRequest {
  /** Origin of the app to photograph. */
  baseURL: string;
  /** Route to open, such as "/?scenario=108" or "/manual". */
  route: string;
  /** Start the game from the route and open `view`; false photographs the route as loaded. */
  game: boolean;
  view:
    "facilities" | "build" | "programs" | "insights" | "events" | "scenario";
  /** `label` names the project and the file; `height` overrides the e2e project's. */
  viewports: { width: number; height?: number; label: string }[];
  themes: ("light" | "dark")[];
  /** Playwright selector; the first match is captured instead of the viewport. */
  clip?: string;
  fullPage: boolean;
  outDir: string;
  /** File name prefix; files are `<name>-<viewport label>-<theme>.png`. */
  name: string;
  /** Milliseconds to let charts and transitions settle before capturing. */
  delay: number;
}

export function readShotRequest(env = process.env): ShotRequest {
  const raw = env.ELECTRIFY_SHOT;
  if (!raw)
    throw new Error(
      "e2e/shot.run.ts takes its options from `npm run shot -- --help`; run it through that command.",
    );
  return JSON.parse(raw) as ShotRequest;
}
