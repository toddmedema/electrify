import { expect, test } from "@playwright/test";

async function openManual(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Manual" }).click();
  await expect(page.getByRole("heading", { name: "Manual" })).toBeVisible();
}

// The manual's list is the scroller, except on short windows (<=768x600) where #gameCard
// takes over and the list stops scrolling (app.scss). These measurements find whichever one
// actually is, so the assertions hold in both layouts. Playwright can't pass functions as
// evaluate arguments, hence the string body.
const GEOMETRY_JS = `(() => {
  const list = document.querySelector("#manual");
  let scroller = null;
  for (let n = list; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) {
      scroller = n;
      break;
    }
  }
  if (!scroller) scroller = document.scrollingElement;
  const sr = scroller.getBoundingClientRect();
  const group = [...list.querySelectorAll(".manual-group")].find(
    (g) => g.textContent === "Gameplay",
  );
  const summary = document.querySelector("#manual-customer-programs-header");
  return {
    scrollerTop: sr.top,
    groupTop: group.getBoundingClientRect().top,
    groupBottom: group.getBoundingClientRect().bottom,
    summaryTop: summary ? summary.getBoundingClientRect().top : null,
    summaryBg: summary ? getComputedStyle(summary).backgroundColor : null,
  };
})()`;

// What GEOMETRY_JS measures, so the evaluate results are typed rather than unknown
interface ManualGeometry {
  scrollerTop: number;
  groupTop: number;
  groupBottom: number;
  summaryTop: number | null;
  summaryBg: string | null;
}

// Move the first element matching `selector` `above` pixels above its scroller's top edge,
// so a sticky header at its top is in its pinned state rather than resting at its natural
// one. The scroller lookup mirrors the short-window fallback in app.scss.
async function pin(
  page: import("@playwright/test").Page,
  selector: string,
  above: number,
) {
  await page.evaluate(
    ([sel, dist]) => {
      const list = document.querySelector("#manual");
      if (!list) throw new Error("Manual list not found");
      let scroller: Element | null = null;
      for (
        let n: Element | null = list;
        n && n !== document.body;
        n = n.parentElement
      ) {
        const cs = getComputedStyle(n);
        if (
          /(auto|scroll)/.test(cs.overflowY) &&
          n.scrollHeight > n.clientHeight + 1
        ) {
          scroller = n;
          break;
        }
      }
      if (!scroller) scroller = document.scrollingElement ?? document.body;
      const target = list.querySelector(sel)!;
      const delta =
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top;
      (scroller as HTMLElement).scrollTop += delta + dist;
    },
    [selector, above] as const,
  );
}

// The Accordion expands with a JS-driven transition (MUI Collapse), and under test-runner
// load its first frame can land well after the click. Wait until the entry's height has
// stopped moving so a measurement sees the settled, fully-expanded card.
async function waitForEntrySettled(
  page: import("@playwright/test").Page,
  selector: string,
) {
  let last = -1;
  for (let i = 0; i < 60; i++) {
    const height = await page.evaluate(
      (sel) =>
        Math.round(document.querySelector(sel)!.getBoundingClientRect().height),
      selector,
    );
    // A collapsed entry is exactly 50px, so a settled one must be taller than that
    if (height > 60 && height === last) {
      return;
    }
    last = height;
    await page.waitForTimeout(50);
  }
}

test("group headers pin flush with the top of the manual, with no gap", async ({
  page,
}) => {
  await openManual(page);

  // Scroll the first group header well past its natural position so it is pinned
  await pin(page, ".manual-group", 100);

  const { scrollerTop, groupTop } =
    await page.evaluate<ManualGeometry>(GEOMETRY_JS);
  // The header must sit exactly at the scroller's top edge: any offset is the gap content
  // scrolls through between it and the chrome above
  expect(Math.abs(groupTop - scrollerTop)).toBeLessThanOrEqual(1);
});

test("an open entry's title pins directly below the group header", async ({
  page,
}) => {
  await openManual(page);

  // "Customer programs" is long enough to scroll through with its title pinned
  await page.locator("#manual-customer-programs-header").click();
  await expect(
    page.locator("#manual-customer-programs-header"),
  ).toHaveAttribute("aria-expanded", "true");
  await waitForEntrySettled(
    page,
    ".manual-entry:has(#manual-customer-programs-header)",
  );

  await pin(page, "#manual-customer-programs-header", 150);

  const { groupBottom, summaryTop, summaryBg } =
    await page.evaluate<ManualGeometry>(GEOMETRY_JS);
  expect(summaryTop).not.toBeNull();
  // The title rests on the group header's bottom edge: no gap above it, no overlap
  expect(Math.abs(summaryTop! - groupBottom)).toBeLessThanOrEqual(1);
  // Opaque, so the entry's content scrolling behind it stays hidden
  const alpha = summaryBg!.includes("rgba")
    ? parseFloat(summaryBg!.split(",")[3])
    : 1;
  expect(alpha).toBe(1);
});

test("a deep-linked entry lands below the pinned group header", async ({
  page,
}) => {
  await openManual(page);

  // Open the pinned overview, then follow one of its related links. The target is a grouped
  // entry, so it must land under the group header rather than with its title hidden behind
  // it. The related link shares the target's name, but in DOM order it comes first
  await page
    .getByRole("button", { name: /how to play/i })
    .first()
    .click();
  await waitForEntrySettled(page, ".manual-pinned");
  await page
    .getByRole("button", { name: "Insights & data layers" })
    .first()
    .click();

  const entryHeader = page.locator("#manual-insights-data-layers-header");
  await expect(entryHeader).toHaveAttribute("aria-expanded", "true");
  await waitForEntrySettled(
    page,
    ".manual-entry:has(#manual-insights-data-layers-header)",
  );

  const { scrollerTop, groupBottom } =
    await page.evaluate<ManualGeometry>(GEOMETRY_JS);
  // The focused entry's title sits at the group header's bottom edge (its pinned position)
  const summaryTop = await entryHeader.evaluate(
    (el) => el.getBoundingClientRect().top,
  );
  expect(Math.abs(summaryTop - groupBottom)).toBeLessThanOrEqual(1);
  // ...and never above the scroller's top edge, where it would be clipped or hidden
  expect(summaryTop).toBeGreaterThanOrEqual(scrollerTop - 1);
});
