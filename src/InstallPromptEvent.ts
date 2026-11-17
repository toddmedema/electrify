export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}
let pending: BeforeInstallPromptEvent | undefined;
export const getPendingInstallPrompt = () => pending;
export function captureInstallPrompt(): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    pending = event as BeforeInstallPromptEvent;
  });
  window.addEventListener("appinstalled", () => {
    pending = undefined;
  });
}
