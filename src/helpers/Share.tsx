import numbro from "numbro";

// Sharing a score, which is the whole point of putting a name and a rank on the board. Kept out
// of Globals so the text builder can be tested without a DOM and the transport without Firebase.

export interface ShareScoreType {
  score: number;
  scenarioName: string;
  difficulty: string;
}

/**
 * How a share actually went. "cancelled" is deliberately distinct from "unavailable": a player who
 * opened the share sheet and backed out did not fail at anything, and should not be told they did.
 */
export type ShareResultType =
  "share" | "clipboard" | "cancelled" | "unavailable";

export function buildShareText({
  score,
  scenarioName,
  difficulty,
}: ShareScoreType): string {
  const formatted = numbro(score).format({
    thousandSeparated: true,
    mantissa: 0,
  });
  return `I scored ${formatted} running ${scenarioName} at ${difficulty} difficulty on Electrify - electrifygame.com`;
}

/** Whether there is any way to share at all, so the button can be hidden rather than dead. */
export function canShare(): boolean {
  return Boolean(
    typeof navigator !== "undefined" &&
    (navigator.share || navigator.clipboard?.writeText),
  );
}

/**
 * Hands the text to the platform share sheet, falling back to the clipboard. A rejected
 * navigator.share is treated as a cancellation and NOT retried against the clipboard: the player
 * just decided not to send this, and quietly copying it anyway is the opposite of what they asked.
 */
export async function shareText(text: string): Promise<ShareResultType> {
  if (typeof navigator === "undefined") {
    return "unavailable";
  }
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return "share";
    } catch (_err) {
      return "cancelled";
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return "clipboard";
    } catch (err) {
      // Denied permission, or an insecure origin. Nothing to fall back to
      console.warn("Couldn't copy the score: ", err);
      return "unavailable";
    }
  }
  return "unavailable";
}
