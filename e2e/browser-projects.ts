import type { Project } from "@playwright/test";

export const browserViewports: Project[] = [
  {
    name: "desktop-chromium",
    use: { browserName: "chromium", viewport: { width: 1280, height: 800 } },
  },
  {
    name: "mobile-390px",
    use: {
      browserName: "chromium",
      hasTouch: true,
      isMobile: true,
      viewport: { width: 390, height: 844 },
    },
  },
  {
    name: "mobile-360px",
    use: {
      browserName: "chromium",
      hasTouch: true,
      isMobile: true,
      viewport: { width: 360, height: 640 },
    },
  },
  {
    name: "tablet-768px",
    use: {
      browserName: "chromium",
      hasTouch: true,
      viewport: { width: 768, height: 1024 },
    },
  },
  {
    name: "foldable-unfolded",
    use: {
      browserName: "chromium",
      hasTouch: true,
      isMobile: true,
      viewport: { width: 844, height: 690 },
    },
  },
  {
    name: "desktop-1440px",
    use: { browserName: "chromium", viewport: { width: 1440, height: 900 } },
  },
];

export const prBrowserViewports = browserViewports.filter(({ name }) =>
  ["desktop-chromium", "mobile-390px", "mobile-360px"].includes(name!),
);

const phone = {
  specs: [
    "build-rail",
    "chart-touch",
    "contextual-learning",
    "facility-selection",
    "game-workspace",
    "grid-status",
    "intertie-order",
    "manual-help-interaction",
    "map-3d",
    "mission-evidence",
    "pwa-sound",
    "tutorial-exit",
  ],
  mixed: [
    "acquisitions",
    "cloud-saves",
    "facilities-production-chart",
    "home-entry",
    "main-menu",
    "menu-keyboard",
    "scenario-pages",
    "tutorial-actions",
  ],
  tag: "@phone",
};
const minimumPhone = {
  specs: [
    "build-rail",
    "home-motion",
    "insights-expanded-chart",
    "insights-responsive",
    "insights-shortfall",
    "modal-layout",
    "multiline-text",
    "project-build",
    "sign-in",
    "ui-chart-build-polish",
  ],
  mixed: [
    "acquisitions",
    "build-options",
    "cities-capacity",
    "facilities-production-chart",
    "game-workspace",
    "learning-pages",
    "main-menu",
    "scenario-pages",
    "tutorial-actions",
  ],
  tag: "@minimum-phone",
};

const localOnly: Record<string, string[]> = {
  "mobile-390px": [
    "browser-theme",
    "custom-location-picker",
    "facilities-scroll",
    "facility-details",
    "facility-drag-targets",
    "frame-budget",
    "insights-history",
    "insights-responsive",
    "map-3d-performance",
    "new-game-responsive",
    "projection-review",
    "save-game",
    "scenario-details",
    "settings-responsive",
  ],
  "mobile-360px": [
    "construction-controls",
    "facility-row-text",
    "menu-page-layout",
    "pane-sticky-headers",
    "settings-responsive",
    "transmission",
    "tutorial-interties",
    "unified-design",
  ],
  "tablet-768px": ["custom-location-picker", "insights-responsive"],
  "foldable-unfolded": [
    "custom-location-picker",
    "short-pane-responsive",
    "ui-controls-regression",
  ],
  "desktop-1440px": [
    "frame-budget",
    "main-menu",
    "performance-responsive",
    "settings-responsive",
    "side-panel-performance",
    "tutorial-capstone",
  ],
};

export function focusBrowserProject(
  project: Project,
  productionCI = false,
): Project {
  const name = project.name!;
  const selection =
    name === "mobile-390px"
      ? phone
      : name === "mobile-360px"
        ? minimumPhone
        : undefined;
  const specs = [
    ...(selection?.specs ?? []),
    ...(productionCI ? [] : (localOnly[name] ?? [])),
  ];
  if (!specs.length) return project;
  const testMatch = [...specs, ...(selection?.mixed ?? [])].map(
    (spec) => `**/${spec}.spec.ts`,
  );
  if (!selection) return { ...project, testMatch };
  // Playwright greps the project, file, test titles and tags in a single string.
  // Select whole focused files and use tags for applicable cases in mixed files.
  const files = specs.map((spec) => `${spec}\\.spec\\.ts`).join("|");
  return {
    ...project,
    testMatch,
    grep: new RegExp(`(?:^|[/ ])(?:${files}|${selection.tag})(?= |$)`),
  };
}
