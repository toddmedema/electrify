/** The startup entrance is already painted from index.html before the game bundle runs. */
export function prepareDesktopStartup(): void {
  const entrance = document.getElementById("appStartup");
  if (!entrance) return;
  entrance.classList.remove("appStartupFailed");
  const status = entrance.querySelector("[data-startup-status]");
  status?.setAttribute("role", "status");
  status?.replaceChildren("Reticulating splines...");
}

export function failDesktopStartup(retry: () => void, quit: () => void): void {
  const entrance = document.getElementById("appStartup");
  const status = entrance?.querySelector("[data-startup-status]");
  if (!entrance || !status) return;
  entrance.classList.add("appStartupFailed");
  status.setAttribute("role", "alert");
  const heading = document.createElement("h1");
  heading.textContent = "Saved games couldn't be restored";
  const message = document.createElement("p");
  message.textContent =
    "Your desktop backup has been kept. Retry before starting a game.";
  const actions = document.createElement("div");
  actions.className = "appStartupActions";
  for (const [label, action] of [
    ["Retry", retry],
    ["Quit", quit],
  ] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", action);
    actions.append(button);
  }
  status.replaceChildren(heading, message, actions);
  actions.querySelector("button")?.focus();
}

/**
 * Called at the app's first commit on web and desktop, with no timeout or animation
 * completion gate.
 */
export function finishStartup(): void {
  const entrance = document.getElementById("appStartup");
  if (!entrance) return;
  const menu = document.querySelector("#menuCard");
  const logo = menu?.querySelector(".homeLogo");
  const before = entrance.querySelector(".homeLogo")?.getBoundingClientRect();
  // Carry the pulse and smoke's clocks into the matching menu logo instead of restarting them.
  const previous = entrance
    .querySelector(".homeLogo")
    ?.getAnimations({ subtree: true });
  const next = logo?.getAnimations({ subtree: true });
  if (previous && next) {
    for (let index = 0; index < next.length; index++) {
      const source = previous[index];
      if (source && typeof source.currentTime === "number") {
        next[index].currentTime =
          source.currentTime +
          (next[index].effect?.getTiming().delay ?? 0) -
          (source.effect?.getTiming().delay ?? 0);
      }
    }
  }
  entrance.remove();
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const after = logo?.getBoundingClientRect();
    if (logo && before && after) {
      logo.animate(
        [
          {
            transform: `translate(${before.x - after.x}px, ${before.y - after.y}px)`,
          },
          { transform: "none" },
        ],
        { duration: 200, easing: "ease-out" },
      );
    }
    menu
      ?.querySelector("#centeredMenu")
      ?.animate([{ opacity: 0.65 }, { opacity: 1 }], {
        duration: 160,
        easing: "ease-out",
      });
  }
}
