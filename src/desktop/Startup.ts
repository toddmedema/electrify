import { focusInitialMenuControl } from "../InitialMenuFocus";

/**
 * The startup entrance is already painted from index.html before the game bundle runs, with the
 * same message as the web build. This only restores that message after a failed attempt is retried;
 * the first call leaves the painted entrance untouched.
 */
export function prepareDesktopStartup(): void {
  const entrance = document.getElementById("appStartup");
  if (!entrance) return;
  const status = entrance.querySelector("[data-startup-status]");
  if (entrance.classList.contains("appStartupFailed")) {
    entrance.classList.remove("appStartupFailed");
    status?.setAttribute("role", "status");
    status?.replaceChildren("Loading…");
  }
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
  document.dispatchEvent(new Event("electrify-ready"));
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const actions = [
      ...(menu?.querySelectorAll<HTMLElement>("#centeredMenu button") ?? []),
    ].filter((control) => control.getClientRects().length > 0);
    const fade = (element: Element, delay: number, duration: number) =>
      element.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration,
        delay,
        easing: "ease-out",
        fill: "backwards",
      });
    const firstDelay = 190;
    const stagger = 105;
    const animations = actions.map((control, index) =>
      fade(control, firstDelay + index * stagger, 140),
    );
    for (const group of menu?.querySelectorAll(
      ".mainMenuFooter, .homeExplore",
    ) ?? [])
      animations.push(fade(group, firstDelay + actions.length * stagger, 180));
    const after = logo?.getBoundingClientRect();
    if (logo && before && after) {
      animations.push(
        logo.animate(
          [
            { transform: `translateY(${before.y - after.y}px)` },
            { transform: "none" },
          ],
          { duration: 440, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        ),
      );
    }
    // Input reveals the menu immediately and never has to wait for its animation.
    const finish = () => animations.forEach((animation) => animation.finish());
    const cleanup = () => {
      menu?.removeEventListener("keydown", finish, true);
      menu?.removeEventListener("click", finish, true);
    };
    menu?.addEventListener("keydown", finish, { once: true, capture: true });
    menu?.addEventListener("click", finish, { once: true, capture: true });
    void Promise.all(animations.map((animation) => animation.finished)).then(
      cleanup,
      cleanup,
    );
  }
  const focusMain = () => {
    if (document.activeElement === document.body)
      focusInitialMenuControl(
        menu?.querySelector<HTMLElement>("[data-main-action]") ?? undefined,
      );
  };
  focusMain();
  // Reduced motion shortens transitions rather than removing them, so the restored visibility
  // only takes effect once that transition starts and ends over the next two frames.
  if (
    menu?.querySelector("[data-main-action]") &&
    document.activeElement === document.body
  )
    window.requestAnimationFrame(() => window.requestAnimationFrame(focusMain));
}
