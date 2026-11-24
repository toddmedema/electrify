(() => {
  const match =
    location.pathname === "/invite/" &&
    !location.search &&
    /^#invite=([A-Za-z0-9_-]{22})$/.exec(location.hash);
  history.replaceState(null, "", "/invite/");
  if (!match) return;

  const token = match[1];
  const web = document.getElementById("web");
  web.href = "/#invite=" + token;
  const appId = document.querySelector(
    'meta[name="electrify-steam-app"]',
  ).content;
  if (/^[1-9][0-9]{0,9}$/.test(appId) && Number(appId) <= 2147483647) {
    const steam = document.getElementById("steam");
    steam.href =
      "steam://run/" +
      appId +
      "//" +
      encodeURIComponent("--electrify-coop=" + token) +
      "/";
    steam.hidden = false;
  }
  document.getElementById("invite-code").value = token;
  document.getElementById("invalid").hidden = true;
  document.getElementById("invitation").hidden = false;
})();
