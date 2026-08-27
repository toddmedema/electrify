import numbro from "numbro";

// Sharing a score, which is the whole point of putting a name and a rank on the board. Kept out
// of Globals so the text builder can be tested without a DOM and the transport without Firebase.

export interface ShareScoreType {
  scenarioId?: number;
  score: number;
  scenarioName: string;
  difficulty: string;
}

export interface ShareContentType {
  title: string;
  text: string;
  url: string;
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

export function buildScoreShareContent(
  score: ShareScoreType,
): ShareContentType {
  const base =
    typeof window === "undefined"
      ? "https://electrifygame.com"
      : window.location.origin;
  const scenario =
    score.scenarioId === undefined ? "" : `scenario=${score.scenarioId}&`;
  return {
    title: `My ${score.scenarioName} score in Electrify`,
    text: `${buildShareText(score)} Can you beat it?`,
    url: `${base}/?${scenario}utm_source=share`,
  };
}

export function buildGameShareContent(): ShareContentType {
  const base =
    typeof window === "undefined"
      ? "https://electrifygame.com"
      : window.location.origin;
  return {
    title: "Electrify — keep the lights on",
    text: "Build power plants, keep the lights on, and make the grid cleaner. No energy experience needed.",
    url: `${base}/?utm_source=share`,
  };
}

/** Whether there is any way to share at all, so the button can be hidden rather than dead. */
export function canShare(): boolean {
  return Boolean(
    typeof navigator !== "undefined" && typeof document !== "undefined",
  );
}

/**
 * Hands the text to the platform share sheet, falling back to the clipboard. A rejected
 * navigator.share is treated as a cancellation and NOT retried against the clipboard: the player
 * just decided not to send this, and quietly copying it anyway is the opposite of what they asked.
 */
export async function shareText(
  content: string | ShareContentType,
): Promise<ShareResultType> {
  if (typeof navigator === "undefined") {
    return "unavailable";
  }
  const share =
    typeof content === "string"
      ? { text: content }
      : { title: content.title, text: content.text, url: content.url };
  const copyText =
    typeof content === "string" ? content : `${content.text}\n${content.url}`;
  if (navigator.share) {
    try {
      await navigator.share(share);
      return "share";
    } catch (_err) {
      return "cancelled";
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(copyText);
      return "clipboard";
    } catch (err) {
      // Denied permission, or an insecure origin. Nothing to fall back to
      console.warn("Couldn't copy the score: ", err);
      return "unavailable";
    }
  }
  // Old/in-app browsers can lack the async clipboard API while still supporting a user-gesture
  // copy. Keeping the button visible is more useful than silently dropping the share path.
  if (typeof document.execCommand !== "function") {
    return "unavailable";
  }
  const textarea = document.createElement("textarea");
  textarea.value = copyText;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy") ? "clipboard" : "unavailable";
  } finally {
    textarea.remove();
  }
}
