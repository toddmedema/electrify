(() => {
  const match =
    location.pathname === "/invite/" &&
    !location.search &&
    /^#invite=([A-Za-z0-9_-]{22})$/.exec(location.hash);
  if (match) location.replace("/#invite=" + match[1]);
})();
