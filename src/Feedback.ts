import { APP_VERSION } from "./AppVersion";
import { getDesktop } from "./Desktop";

export interface FeedbackContext {
  source: "game-menu" | "tutorial" | "scenario";
  scenarioId?: number;
  outcome?: "completed" | "bankrupt" | "fired";
}

export interface FeedbackSubmission extends FeedbackContext {
  requestId: string;
  message: string;
  replyEmail: string;
  appVersion: string;
}

// Match the Steam text input limit across all feedback entry points.
export const FEEDBACK_MESSAGE_LIMIT = 2048;
export const FEEDBACK_EMAIL_LIMIT = 254;

export async function submitFeedback(
  input: Omit<FeedbackSubmission, "appVersion">,
): Promise<void> {
  const data = { ...input, appVersion: APP_VERSION };
  if (process.env.REACT_APP_DESKTOP === "true") {
    const desktop = getDesktop();
    if (desktop) {
      if (!desktop.submitFeedback) throw new Error("Feedback is unavailable");
      await desktop.submitFeedback(data);
      return;
    }
  }

  // The callable wire format is also used by Electron's isolated main process.
  // This endpoint accepts anonymous feedback and does not need account credentials.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(
      "https://us-central1-electrify-game.cloudfunctions.net/submitGameFeedback",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
        signal: controller.signal,
      },
    );
    if (!response.ok || (await response.json()).result?.sent !== true) {
      throw new Error("Feedback is unavailable");
    }
  } finally {
    clearTimeout(timeout);
  }
}
