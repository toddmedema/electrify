/** Keep recovery available even when the full stylesheet or React entry fails. */
export function showBootstrapFailure(): void {
  const status = document.querySelector<HTMLElement>("[data-startup-status]");
  if (!status) return;
  status.setAttribute("role", "alert");
  const message = document.createElement("p");
  message.textContent =
    "Electrify couldn't finish loading. Check your connection and reload.";
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload Electrify";
  reload.style.cssText = "min-height:44px;padding:8px 16px;font:inherit";
  reload.onclick = () => window.location.reload();
  status.replaceChildren(message, reload);
}
