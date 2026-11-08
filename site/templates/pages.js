function header(current) {
  return `<a class="skip-link" href="#main-content">Skip to content</a>
    <header class="topbar">
      <div class="topbar__inner">
        <a class="brand" href="/" aria-label="Electrify home">
          <picture>
            <source srcset="/images/logo-dark.svg" media="(prefers-color-scheme: dark)" />
            <img src="/images/logo.svg" alt="" width="300" height="70" />
          </picture>
        </a>
        <nav class="topnav" aria-label="Primary navigation">
          <a href="/about.html">About</a>
          <a href="/scenarios.html"${current ? ' aria-current="page"' : ""}>Scenarios</a>
          <a class="topnav__play" href="/">Play</a>
        </nav>
      </div>
    </header>`;
}

function footer() {
  return `<footer class="site-footer">
      <div class="site-footer__inner">
        <p>Electrify. Take charge of the power markets.</p>
        <nav aria-label="Footer navigation">
          <a href="/scenarios.html">All scenarios</a>
          <a href="/about.html">About</a>
          <a href="/privacy.html">Privacy</a>
          <a href="https://github.com/toddmedema/electrify">Source code</a>
        </nav>
      </div>
    </footer>`;
}

function documentShell(metadata, body, schema, context, isIndex = false) {
  const e = context.escapeHtml;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${e(metadata.title)}</title>
    <meta name="description" content="${e(metadata.description)}" />
    <meta name="theme-color" content="#0084f8" />
    <link rel="icon" href="/favicon.ico" />
    <link rel="stylesheet" href="/legal.css" />
    <link rel="stylesheet" href="/scenarios.css" />
    <link rel="canonical" href="${e(metadata.canonical)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Electrify" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:title" content="${e(metadata.title)}" />
    <meta property="og:description" content="${e(metadata.description)}" />
    <meta property="og:url" content="${e(metadata.canonical)}" />
    <meta property="og:image" content="${e(metadata.image)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Electrify gameplay showing power plants, electricity supply and demand, and grid finances" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@toddmedema" />
    <meta name="twitter:title" content="${e(metadata.title)}" />
    <meta name="twitter:description" content="${e(metadata.description)}" />
    <meta name="twitter:image" content="${e(metadata.image)}" />
    <meta name="twitter:image:alt" content="Electrify gameplay showing power plants, electricity supply and demand, and grid finances" />
    <script type="application/ld+json">${context.jsonLd(schema)}</script>
  </head>
  <body class="scenario-site${isIndex ? " scenario-directory" : " scenario-detail"}">
    ${header(isIndex)}
    ${body}
    ${footer()}
  </body>
</html>`;
}

function facts(page, context) {
  const e = context.escapeHtml;
  return `<dl class="scenario-facts">
    <div><dt>Location</dt><dd>${e(page.location)}</dd></div>
    <div><dt>Starts in</dt><dd>${e(page.startingYear)}</dd></div>
    <div><dt>${page.kind === "campaign" ? "Generation" : "Time to plan"}</dt><dd>${e(page.durationYears)} years</dd></div>
  </dl>`;
}

function entry(page, context, compact = false) {
  const e = context.escapeHtml;
  return `<li class="scenario-entry${compact ? " scenario-entry--compact" : ""}">
    <a class="scenario-entry__link" href="${e(context.scenarioPath(page))}">
      <img src="${e(context.iconUrl(page))}" alt="" width="64" height="64" loading="lazy" />
      <div class="scenario-entry__copy">
        <p class="scenario-entry__meta">${e(page.location)} <span aria-hidden="true">·</span> ${e(page.startingYear)}</p>
        <h3>${e(page.name)}</h3>
        <p class="scenario-entry__dek">${e(page.dek)}</p>
        <span class="scenario-entry__more">Explore scenario <span aria-hidden="true">↗</span></span>
      </div>
    </a>
  </li>`;
}

function renderScenarioPage(page, context) {
  const e = context.escapeHtml;
  const metadata = context.metadata(page);
  const isCampaign = page.kind === "campaign";
  const action = isCampaign
    ? "Explore the Legacy campaign"
    : `Play ${page.name}`;
  const related = context.relatedPages(page);
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${metadata.canonical}#webpage`,
        url: metadata.canonical,
        name: metadata.title,
        description: page.description,
        inLanguage: "en",
        isPartOf: { "@id": `${context.origin}/#website` },
        mainEntity: {
          "@type": "VideoGame",
          name: `${page.name} — Electrify scenario`,
          description: page.description,
          url: metadata.canonical,
          gamePlatform: "Web browser",
          genre: "Strategy",
          isAccessibleForFree: true,
          isPartOf: {
            "@type": "VideoGame",
            name: "Electrify",
            url: `${context.origin}/`,
          },
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Electrify",
            item: `${context.origin}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Scenarios",
            item: `${context.origin}/scenarios.html`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: page.name,
            item: metadata.canonical,
          },
        ],
      },
    ],
  };
  const body = `<main id="main-content">
      <section class="hero scenario-hero" aria-labelledby="page-title">
        <div class="hero__inner">
          <nav class="scenario-breadcrumb" aria-label="Breadcrumb"><a href="/scenarios.html">All scenarios</a><span aria-hidden="true">/</span><span>${isCampaign ? "Legacy campaign" : "Official scenario"}</span></nav>
          <div class="scenario-hero__layout">
            <div class="hero__copy">
              <p class="eyebrow">${e(page.theme)}</p>
              <h1 id="page-title">${e(page.name)}</h1>
              <p class="hero__lede">${e(page.dek)}</p>
              <div class="hero__actions">
                <a class="button button--primary" href="${e(context.playUrl(page))}">${e(action)}<span aria-hidden="true">↗</span></a>
                <a class="scenario-text-link" href="#your-decisions">See what’s at stake <span aria-hidden="true">↓</span></a>
              </div>
              <p class="scenario-play-note">${isCampaign ? "Build one utility across nine generations. This chapter is part of that journey." : "Free to play in your browser. Choose your difficulty in the game."}</p>
            </div>
            <aside class="scenario-brief" aria-label="Scenario at a glance">
              <img class="scenario-brief__icon" src="${e(context.iconUrl(page))}" alt="" width="192" height="192" />
              ${facts(page, context)}
            </aside>
          </div>
        </div>
      </section>
      <div class="page-content scenario-content">
        <section class="scenario-start" aria-labelledby="starting-title">
          <div class="scenario-section-label"><p class="eyebrow">The situation</p><h2 id="starting-title">Your starting point</h2></div>
          <div class="scenario-prose">${page.setup.map((paragraph) => `<p>${e(paragraph)}</p>`).join("\n")}</div>
        </section>
        <section class="scenario-decisions" aria-labelledby="your-decisions">
          <div class="scenario-section-label"><p class="eyebrow">The choices</p><h2 id="your-decisions">What will you do?</h2></div>
          <ol class="scenario-decisions__list">${page.decisions.map((decision, index) => `<li><span class="scenario-decision-number" aria-hidden="true">0${index + 1}</span><div><h3>${e(decision.title)}</h3><p>${e(decision.body)}</p></div></li>`).join("\n")}</ol>
        </section>
        <section class="scenario-invitation" aria-labelledby="try-title">
          <div><p class="eyebrow">Put your plan to the test</p><h2 id="try-title">${e(page.takeaway)}</h2>${isCampaign ? "<p>Open the campaign setup to begin, or continue your existing company. Later generations inherit the choices you made before them.</p>" : "<p>Build, watch what happens, and try a different approach. The grid is yours to run.</p>"}</div>
          <a class="button button--primary" href="${e(context.playUrl(page))}">${isCampaign ? "Open the campaign" : "Try this scenario"}<span aria-hidden="true">↗</span></a>
        </section>
        <section class="scenario-related" aria-labelledby="related-title">
          <div class="scenario-related__heading"><div><p class="eyebrow">Keep exploring</p><h2 id="related-title">A different challenge</h2></div><a class="scenario-text-link" href="/scenarios.html">All scenarios <span aria-hidden="true">→</span></a></div>
          <ul class="scenario-entries">${related.map((other) => entry(other, context, true)).join("\n")}</ul>
        </section>
      </div>
    </main>`;
  return documentShell(metadata, body, schema, context);
}

const themeIntroductions = {
  "Energy transition":
    "Replace an aging fleet, cut emissions, and work out what keeps the lights on when the sun goes down.",
  "Extreme weather":
    "Make room for the days when demand rises and the power plants you counted on cannot deliver.",
  "Rapid growth":
    "More customers bring more revenue. They also need power before your next plant is ready.",
  "Legacy campaign":
    "Start a utility in 1882 and carry it through nine generations. Each chapter inherits the company you built.",
};

function themeId(theme) {
  return theme.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function renderScenarioIndex(pages, context) {
  const e = context.escapeHtml;
  const metadata = context.metadata(null);
  const themes = [...new Set(pages.map((page) => page.theme))];
  const featured = [100, 107, 106, 105]
    .map((id) => pages.find((page) => page.scenarioId === id))
    .filter(Boolean);
  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${metadata.canonical}#webpage`,
    url: metadata.canonical,
    name: metadata.title,
    description: metadata.description,
    inLanguage: "en",
    isPartOf: { "@id": `${context.origin}/#website` },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: pages.length,
      itemListElement: pages.map((page, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: page.name,
        url: `${context.origin}${context.scenarioPath(page)}`,
      })),
    },
  };
  const body = `<main id="main-content">
      <section class="hero scenario-directory-hero" aria-labelledby="page-title">
        <div class="hero__inner">
          <div class="scenario-directory-hero__layout">
            <div class="hero__copy">
              <p class="eyebrow">The scenarios of Electrify</p>
              <h1 id="page-title">A different grid.<br />A different problem.</h1>
              <p class="hero__lede">An island running on imported oil. A city racing to supply new data centers. A utility with a century of decisions ahead of it. Where will you take charge?</p>
              <div class="hero__actions"><a class="button button--primary" href="#scenario-catalog">Find your scenario <span aria-hidden="true">↓</span></a><a class="scenario-text-link" href="/power-grid-simulator.html">New here? See how it plays <span aria-hidden="true">→</span></a></div>
            </div>
            <div class="scenario-directory-art" aria-hidden="true">${featured.map((page) => `<img src="${e(context.iconUrl(page))}" alt="" width="140" height="140" />`).join("\n")}<p>One grid.<br /><strong>Your decisions.</strong></p></div>
          </div>
        </div>
      </section>
      <div class="page-content scenario-catalog" id="scenario-catalog">
        <div class="scenario-catalog__intro"><div><p class="eyebrow">Choose what matters to you</p><h2>Find a grid worth figuring out</h2></div><p>Every scenario puts reliability, costs, and emissions in your hands. Read the situation, pick your challenge, and try your plan.</p></div>
        <nav class="scenario-theme-nav" aria-label="Browse scenarios by theme">${themes.map((theme) => `<a href="#${themeId(theme)}">${e(theme)}<span aria-hidden="true">↓</span></a>`).join("\n")}</nav>
        ${themes
          .map(
            (theme) =>
              `<section class="scenario-group" aria-labelledby="${themeId(theme)}"><div class="scenario-group__heading"><h2 id="${themeId(theme)}">${e(theme)}</h2>${themeIntroductions[theme] ? `<p>${e(themeIntroductions[theme])}</p>` : ""}</div><ul class="scenario-entries">${pages
                .filter((page) => page.theme === theme)
                .map((page) => entry(page, context))
                .join("\n")}</ul></section>`,
          )
          .join("\n")}
        <section class="scenario-directory-ending" aria-labelledby="your-grid-title"><div><p class="eyebrow">Closer to home</p><h2 id="your-grid-title">What would you do with your own grid?</h2><p>Choose a location and explore the effect of new data-center demand in a custom game.</p></div><a class="button" href="/data-centers.html">Explore your local grid <span aria-hidden="true">→</span></a></section>
      </div>
    </main>`;
  return documentShell(metadata, body, schema, context, true);
}

module.exports = { renderScenarioPage, renderScenarioIndex };
