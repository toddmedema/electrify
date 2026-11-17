// Shared by the game and public pages. Keep the web stream and Google tag lifecycle here.
(function () {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.electrifyAnalytics) return;

  const MEASUREMENT_ID = "G-M064W1XFDY";
  const MAX_PENDING_EVENTS = 100;
  const RETRY_DELAY_MS = 30000;
  const LOAD_TIMEOUT_MS = 15000;
  // The game can start before this asynchronous local script arrives.
  const pending = (window.electrifyAnalyticsQueue || []).slice(
    0,
    MAX_PENDING_EVENTS,
  );
  delete window.electrifyAnalyticsQueue;
  let startAllowed = false;
  let configured = false;
  let loaded = false;
  let loadingScript;
  let retryAfter = 0;

  function enabled() {
    return (
      /^https?:$/.test(window.location.protocol) &&
      !window.electrifyDesktop &&
      !window.electrifyCouch
    );
  }

  function initialize(reconnected) {
    if (
      !enabled() ||
      !startAllowed ||
      loaded ||
      loadingScript ||
      !window.navigator.onLine ||
      (!reconnected && Date.now() < retryAfter)
    )
      return;
    let script;
    let timeout;
    try {
      if (!configured) {
        window.dataLayer = window.dataLayer || [];
        window.gtag = function () {
          window.dataLayer.push(arguments);
        };
        window.gtag("js", new Date());
        // One config owns the initial document page_view; card_view stays a custom event.
        window.gtag("config", MEASUREMENT_ID);
        configured = true;
      }
      script = document.createElement("script");
      script.async = true;
      script.src =
        "https://www.googletagmanager.com/gtag/js?id=" + MEASUREMENT_ID;
      loadingScript = script;
      const failed = function () {
        if (loadingScript !== script) return;
        window.clearTimeout(timeout);
        script.remove();
        loadingScript = undefined;
        retryAfter = Date.now() + RETRY_DELAY_MS;
      };
      script.onerror = failed;
      script.onload = function () {
        if (loadingScript !== script) return;
        window.clearTimeout(timeout);
        loaded = true;
        loadingScript = undefined;
        const events = pending.splice(0);
        for (const event of events) send(event);
      };
      timeout = window.setTimeout(failed, LOAD_TIMEOUT_MS);
      document.head.appendChild(script);
    } catch {
      window.clearTimeout(timeout);
      script?.remove();
      loadingScript = undefined;
      retryAfter = Date.now() + RETRY_DELAY_MS;
      // Analytics is optional: blocked scripts, DOM failures and offline starts cannot stop play.
    }
  }

  function send(event) {
    try {
      window.gtag("event", event.name, event.params);
    } catch {
      // A third-party transport failure must never escape into the game.
    }
  }

  window.electrifyAnalytics = {
    initialize: function () {
      initialize(false);
    },
    logEvent: function (name, params) {
      if (!enabled()) return;
      const event = { name: name, params: params };
      if (loaded) send(event);
      else {
        // Keep early events in order without an ever-growing queue behind an ad blocker.
        if (pending.length < MAX_PENDING_EVENTS) pending.push(event);
        initialize(false);
      }
    },
  };
  window.addEventListener("online", function () {
    initialize(true);
  });
  function schedule() {
    const start = function () {
      startAllowed = true;
      initialize(false);
    };
    // Leave document loading and the first render free of the third-party tag.
    if (window.requestIdleCallback)
      window.requestIdleCallback(start, { timeout: 2000 });
    else window.setTimeout(start, 0);
  }
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
})();
