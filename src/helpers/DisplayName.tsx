// The leaderboard name a player picks. Kept deliberately free of Firebase so the rules it
// enforces can be read (and tested) in one place -- firestore.rules re-states the same
// constraints, because only the server can actually make them true.

export const DISPLAY_NAME_MIN_LENGTH = 3;
export const DISPLAY_NAME_MAX_LENGTH = 20;

// Not a moderation system, and not trying to be one: this only stops the handful of names that
// would let someone pose as the game or its staff on a public board.
const BLOCKED_NAMES = [
  "admin",
  "administrator",
  "anonymous",
  "electrify",
  "moderator",
  "mod",
  "support",
  "system",
];

/**
 * What the player typed, as it would be stored. Surrounding whitespace is forgiven rather than
 * rejected -- it is almost always a stray copy/paste rather than a name someone meant to type.
 */
export function normalizeDisplayName(raw: string): string {
  return raw.trim();
}

/** The key a name is claimed under, so that Ada and ada cannot both exist. */
export function displayNameKey(name: string): string {
  return normalizeDisplayName(name).toLowerCase();
}

/**
 * Why a name cannot be used, or undefined when it can. A message rather than a boolean, because
 * every caller has to tell the player what to change.
 */
export function validateDisplayName(raw: string): string | undefined {
  const name = normalizeDisplayName(raw);
  if (name.length < DISPLAY_NAME_MIN_LENGTH) {
    return `Names need at least ${DISPLAY_NAME_MIN_LENGTH} characters.`;
  }
  if (name.length > DISPLAY_NAME_MAX_LENGTH) {
    return `Names can be at most ${DISPLAY_NAME_MAX_LENGTH} characters.`;
  }
  if (!/^[A-Za-z0-9 _-]+$/.test(name)) {
    return "Names can only use letters, numbers, spaces, hyphens and underscores.";
  }
  if (name.includes("  ")) {
    return "Names can't contain double spaces.";
  }
  if (BLOCKED_NAMES.indexOf(name.toLowerCase()) !== -1) {
    return "That name is reserved. Please pick another.";
  }
  return undefined;
}

/**
 * A starting point for the name dialog, from whatever the identity provider handed over. Google
 * names are full names, which are frequently too long and often contain characters the board
 * doesn't take, so this trims rather than rejects -- a suggestion the player can overwrite is
 * worth more than an empty box.
 */
export function suggestDisplayName(googleDisplayName?: string | null): string {
  if (!googleDisplayName) {
    return "";
  }
  const cleaned = googleDisplayName
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .replace(/ +/g, " ")
    .trim()
    .slice(0, DISPLAY_NAME_MAX_LENGTH)
    .trim();
  return validateDisplayName(cleaned) ? "" : cleaned;
}
