import type { ShareContentType, ShareResultType } from "./Share";

export function buildGameShareContent(): ShareContentType {
  const base =
    typeof window === "undefined"
      ? "https://electrifygame.com"
      : window.location.origin;
  return {
    title: "Electrify — take charge of the power markets",
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
