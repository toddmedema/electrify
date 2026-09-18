import { expect, test } from "@playwright/test";

// The tutorial cue is a ring overlay around the highlighted control. It must stay visible on
// all four sides even when the control runs edge to edge: a pane, a card or the viewport clips
// anything drawn outside it, which is how an outline used to lose its left and right sides.
// Where the control itself extends past a clipping edge (a scrolled card), the ring hugs that
// boundary instead, so it always frames whatever part of the control is visible.
test("keeps the tutorial ring visible on all sides of a full-bleed chart", async ({
  page,
}, testInfo) => {
  await page.addInitScript(
    ({ theme }) => {
      localStorage.clear();
      localStorage.setItem("theme", theme);
    },
    // The ring is a flat blue line, so prove it reads in both palettes: light on desktop
    // projects, dark on the mobile ones.
    { theme: testInfo.project.name.startsWith("mobile-") ? "dark" : "light" },
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();
  const hud = page.locator(".tutorialHud");
  await hud.waitFor({ timeout: 20_000 });

  // Step one asks for a tap on the coal plant; step two is the supply/demand chart, which runs
  // edge to edge in every layout.
  await page.getByRole("button", { name: "Inspect Coal", exact: true }).click();
  await expect(hud.getByText("Find the supply and demand lines")).toBeVisible();
  const chart = page.locator("#chartSupplyDemand");
  await expect(chart).toBeVisible();
  // On short viewports the chart can sit below the fold; bring it into view like a player
  // would before judging what the highlight shows.
  await chart.scrollIntoViewIfNeeded();

  const ring = page.locator(".tutorialTargetRing");
  await expect(ring).toHaveCount(1);
  await expect(ring.first()).toBeVisible();

  // The ring must draw a line on all four sides -- the left and right ones are what an
  // outline lost wherever a control ran edge to edge.
  const borderSides = await ring.first().evaluate((el) => {
    const style = getComputedStyle(el);
    return [
      style.borderTopWidth,
      style.borderRightWidth,
      style.borderBottomWidth,
      style.borderLeftWidth,
    ];
  });
  for (const side of borderSides) {
    expect(side).toBe("2px");
  }

  // The chart's box and the smallest rectangle it can be drawn in (the viewport narrowed by
  // every clipping ancestor and sticky bar), measured the same way the ring is positioned.
  const { target, clip } = await page.evaluate(() => {
    const el = document.querySelector("#chartSupplyDemand")!;
    const r = el.getBoundingClientRect();
    // DOMRect properties live on the prototype, so copy them explicitly.
    const target = { x: r.x, y: r.y, width: r.width, height: r.height };
    let left = 0;
    let top = 0;
    let right = innerWidth;
    let bottom = innerHeight;
    for (
      let a = el.parentElement;
      a && left < right && top < bottom;
      a = a.parentElement
    ) {
      const s = getComputedStyle(a);
      if (s.overflowX === "visible" && s.overflowY === "visible") continue;
      const b = a.getBoundingClientRect();
      left = Math.max(left, b.left);
      top = Math.max(top, b.top);
      right = Math.min(right, b.right);
      bottom = Math.min(bottom, b.bottom);
      // A sticky bar lying across the chart (the nav footer on short phones) covers it too.
      for (const child of Array.from(a.children)) {
        const cs = getComputedStyle(child);
        if (cs.position !== "sticky" || child.contains(el)) continue;
        const bar = child.getBoundingClientRect();
        if (bar.bottom <= r.top || bar.top >= r.bottom) continue;
        if (cs.bottom !== "auto") {
          bottom = Math.max(top, Math.min(bottom, bar.top));
        } else if (cs.top !== "auto") {
          top = Math.min(bottom, Math.max(top, bar.bottom));
        }
      }
    }
    return { target, clip: { left, top, right, bottom } };
  });

  // The ring's line sits at most a gap plus its own width outside the control, and never
  // inside both the control's edge and the clipping boundary. The ring is positioned in whole
  // pixels, so allow for rounding on top of the gap. Poll through the next animation frame
  // after the scroll above so layout and the overlay have both been painted.
  const MAX_OFFSET = 6; // 3px gap + 2px line, plus rounding
  const ROUNDING = 1;
  await expect
    .poll(async () => {
      const box = (await ring.first().boundingBox())!;
      return [
        box.x >= Math.min(clip.left, target.x) - MAX_OFFSET,
        box.x <= Math.max(clip.left, target.x) + ROUNDING,
        box.y >= Math.min(clip.top, target.y) - MAX_OFFSET,
        box.y <= Math.max(clip.top, target.y) + ROUNDING,
        box.x + box.width >=
          Math.min(clip.right, target.x + target.width) - ROUNDING,
        box.x + box.width <=
          Math.max(clip.right, target.x + target.width) + MAX_OFFSET,
        box.y + box.height >=
          Math.min(clip.bottom, target.y + target.height) - ROUNDING,
        box.y + box.height <=
          Math.max(clip.bottom, target.y + target.height) + MAX_OFFSET,
      ].every(Boolean);
    })
    .toBe(true);
});
