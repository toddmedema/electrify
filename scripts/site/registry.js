// Existing hand-authored pages and generated scenario pages share one discovery registry.
// Keep these paths stable: they are public URLs, independent of the game's React navigation.
const ORIGIN = "https://electrifygame.com";
const STATIC_PAGES = [
  { path: "/", title: "Play Electrify" },
  { path: "/about.html", title: "About Electrify and contact" },
  { path: "/data-centers.html", title: "Data centers and your grid" },
  { path: "/electrify-vs-en-roads.html", title: "Electrify and En-ROADS" },
  { path: "/power-grid-simulator.html", title: "How Electrify plays" },
  { path: "/classroom.html", title: "Electrify in the classroom" },
  { path: "/energy-simulators.html", title: "Energy and climate simulators" },
  { path: "/privacy.html", title: "Privacy" },
];

module.exports = { ORIGIN, STATIC_PAGES };
