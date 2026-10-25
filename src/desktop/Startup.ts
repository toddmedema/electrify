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

/** Keep even a cached startup visible for 500ms, measured from the early HTML entrance. */
export function finishStartup(): void {
  const entrance = document.getElementById("appStartup");
  // StrictMode commits twice; only one handoff may own the overlay and animations.
  if (!entrance || entrance.dataset.handoffPending) return;
  entrance.dataset.handoffPending = "true";
  const root = document.getElementById("root");
  const visibility = root?.style.visibility ?? "";
  if (root) {
    root.inert = true;
    root.style.visibility = "hidden";
  }
  const remaining = Math.max(
    0,
    Math.ceil(
      500 - (performance.now() - Number(entrance.dataset.startedAt ?? 0)),
    ),
  );
  const handoff = () => {
    if (root) {
      root.inert = false;
      root.style.visibility = visibility;
    }
    if (entrance.isConnected) revealMenu(entrance);
  };
  if (remaining > 0) window.setTimeout(handoff, remaining);
  else handoff();
}

function revealMenu(entrance: HTMLElement): void {
  const menu = document.querySelector<HTMLElement>("#menuCard");
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
    const controls = Array.from(
      menu?.querySelectorAll<HTMLElement>("button, a[href]") ?? [],
    ).filter((control) => control.getClientRects().length > 0);
    const animations = controls.map((control, index) =>
      control.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 300,
        delay: 180 + index * 80,
        easing: "ease-out",
        fill: "backwards",
      }),
    );
    const after = logo?.getBoundingClientRect();
    if (logo && before && after) {
      // Move the menu with the logo so fading controls always keep their final spacing.
      for (const element of [logo, menu?.querySelector("#centeredMenu")]) {
        if (element)
          animations.push(
            element.animate(
              [
                { transform: `translateY(${before.y - after.y}px)` },
                { transform: "none" },
              ],
              {
                duration: Math.max(900, 480 + (controls.length - 1) * 80),
                easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
              },
            ),
          );
      }
    }
    // Translated controls must not create a temporary scrollbar; restore normal scrolling
    // when the entrance finishes, including on short screens that need it for the full menu.
    const overflow = menu?.style.overflow ?? "";
    if (menu) menu.style.overflow = "clip";
    // Keyboard/controller or pointer input should reveal its target immediately.
    const finish = () => animations.forEach((animation) => animation.finish());
    const cleanup = () => {
      if (menu) menu.style.overflow = overflow;
      menu?.removeEventListener("keydown", finish, true);
      menu?.removeEventListener("click", finish, true);
    };
    menu?.addEventListener("keydown", finish, { once: true, capture: true });
    // Complete pointer activation before moving its target to the resting position.
    menu?.addEventListener("click", finish, {
      once: true,
      capture: true,
    });
    void Promise.all(animations.map((animation) => animation.finished)).then(
      cleanup,
      cleanup,
    );
  }
  if (document.activeElement === document.body)
    menu
      ?.querySelector<HTMLElement>("[data-main-action]")
      ?.focus({ preventScroll: true });
}
