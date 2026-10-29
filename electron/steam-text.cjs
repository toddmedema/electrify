// Steam's viewing client localizes rich presence tokens. The game currently supports
// English; other Steam UI languages use this same English fallback for Timeline text.
const TEXT = {
  menu: "At the main menu",
  loading: "Loading the grid",
  playing: "Managing the grid",
  paused: "Grid paused",
  victory: "Scenario completed",
  ended: "Run ended",
  custom: "Custom grid",
  year: "Year {year} of {total}",
  construction: "Major construction completed",
  blackout: "Blackout",
  recovery: "Power restored",
  victoryMarker: "Scenario completed",
};

function presenceTokens(scenarios) {
  const tokens = {
    "#Status_menu": TEXT.menu,
    "#Status_loading": TEXT.loading,
    "#Scenario_custom": TEXT.custom,
  };
  for (const phase of ["playing", "paused", "victory", "ended"]) {
    tokens[`#Status_${phase}`] = `{#Scenario_%scenario%} · ${TEXT[phase]}`;
    tokens[`#Status_${phase}Progress`] =
      `{#Scenario_%scenario%} · ${TEXT.year.replace("{year}", "%year%").replace("{total}", "%total%")}${phase === "playing" ? "" : ` · ${TEXT[phase]}`}`;
  }
  for (const [id, scenario] of Object.entries(scenarios))
    tokens[`#Scenario_${id}`] = scenario.name;
  return tokens;
}

module.exports = { TEXT, presenceTokens };
