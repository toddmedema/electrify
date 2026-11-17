// Existing hand-authored pages and generated scenario pages share one discovery registry.
// Keep these paths stable: they are public URLs, independent of the game's React navigation.
const ORIGIN = "https://electrifygame.com";
const STATIC_PAGES = [
  { path: "/", source: "public/index.html", title: "Play Electrify" },
  {
    path: "/about.html",
    source: "public/about.html",
    title: "About Electrify and contact",
  },
  {
    path: "/data-centers.html",
    source: "public/data-centers.html",
    title: "Data centers and your grid",
  },
  {
    path: "/electrify-vs-en-roads.html",
    source: "public/electrify-vs-en-roads.html",
    title: "Electrify and En-ROADS",
  },
  {
    path: "/power-grid-simulator.html",
    source: "public/power-grid-simulator.html",
    title: "How Electrify plays",
  },
  {
    path: "/classroom.html",
    source: "public/classroom.html",
    title: "Electrify in the classroom",
  },
  {
    path: "/energy-simulators.html",
    source: "public/energy-simulators.html",
    title: "Energy and climate simulators",
  },
  { path: "/privacy.html", source: "public/privacy.html", title: "Privacy" },
];

module.exports = { ORIGIN, STATIC_PAGES };
