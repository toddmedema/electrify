function confirmFullscreen(window, fullscreen, request, timeoutMs) {
  if (window.isDestroyed() || window.isFullScreen() === fullscreen)
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    const event = fullscreen ? "enter-full-screen" : "leave-full-screen";
    const cleanup = () => {
      clearTimeout(timeout);
      window.removeListener(event, done);
      window.removeListener("closed", done);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("The native fullscreen transition timed out"));
    }, timeoutMs);
    window.once(event, done);
    window.once("closed", done);
    try {
      request();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/** Observe native completion without changing the window's requested display mode. */
function waitForFullscreen(window, fullscreen, timeoutMs = 5000) {
  return confirmFullscreen(window, fullscreen, () => {}, timeoutMs);
}

/** Wait for the native fullscreen transition before another queued display change. */
function setFullscreen(window, fullscreen, timeoutMs = 5000) {
  return confirmFullscreen(
    window,
    fullscreen,
    () => window.setFullScreen(fullscreen),
    timeoutMs,
  );
}

async function applyNativeDisplay(
  window,
  next,
  wait = () => new Promise((resolve) => setTimeout(resolve, 75)),
) {
  await setFullscreen(window, next.fullscreen);
  if (window.isDestroyed())
    throw new Error("The game window closed during the display change");
  if (next.fullscreen) return next;
  window.unmaximize();
  let requestedWidth = next.width;
  let requestedHeight = next.height;
  window.setContentSize(requestedWidth, requestedHeight);
  window.center();
  // Fractional-DPI Windows frames can round once when sizing and again when
  // centering. Compensate after settling without moving the frame a second time.
  for (let attempt = 0; attempt <= 3; attempt++) {
    await wait();
    if (window.isDestroyed())
      throw new Error("The game window closed during the display change");
    if (window.isFullScreen())
      throw new Error(
        "The window entered fullscreen during the display change",
      );
    const [width, height] = window.getContentSize();
    if (
      Math.abs(width - next.width) <= 1 &&
      Math.abs(height - next.height) <= 1
    )
      return next;
    if (attempt === 3) return { fullscreen: false, width, height };
    requestedWidth -= width - next.width;
    requestedHeight -= height - next.height;
    window.setContentSize(
      Math.max(1, requestedWidth),
      Math.max(1, requestedHeight),
    );
  }
}

async function applyConfirmedDisplay(
  window,
  previous,
  next,
  commit,
  apply = applyNativeDisplay,
) {
  try {
    const confirmed = await apply(window, next);
    commit(confirmed);
    return confirmed;
  } catch (error) {
    if (window.isDestroyed()) throw error;
    let restored;
    try {
      restored = await apply(window, previous);
    } catch {
      // If the OS also rejects rollback, report/persist its actual applied state.
      const [width, height] = window.getContentSize();
      restored = window.isFullScreen()
        ? { ...previous, fullscreen: true }
        : { fullscreen: false, width, height };
    }
    commit(restored);
    throw error;
  }
}

function createDisplayQueue(update) {
  let queue = Promise.resolve();
  let desired;
  let sequence = 0;
  let accepting = true;
  return {
    intended: (confirmed) => desired || confirmed,
    pause: () => {
      accepting = false;
    },
    resume: () => {
      accepting = true;
    },
    drain: () => {
      accepting = false;
      return queue.catch(() => {});
    },
    apply: (next) => {
      if (!accepting) return Promise.reject(new Error("The game is closing"));
      desired = next;
      const request = ++sequence;
      const task = queue
        .catch(() => {})
        .then(() => update(next))
        .finally(() => {
          if (request === sequence) desired = undefined;
        });
      queue = task;
      return task;
    },
  };
}

module.exports = {
  waitForFullscreen,
  setFullscreen,
  applyNativeDisplay,
  applyConfirmedDisplay,
  createDisplayQueue,
};
