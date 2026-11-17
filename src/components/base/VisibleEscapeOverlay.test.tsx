import * as React from "react";
import { render, screen } from "@testing-library/react";
import { hasVisibleEscapeOverlay } from "./VisibleEscapeOverlay";

it("does not treat the nonmodal tile inspector as an Escape overlay", () => {
  render(<section role="dialog">Tile inspector</section>);
  expect(hasVisibleEscapeOverlay()).toBe(false);
});

it.each([
  <div className="MuiModal-root">Confirmation</div>,
  <ul role="menu">Menu</ul>,
  <ul role="listbox">Select options</ul>,
  <section data-escape-overlay="true">Technology preview</section>,
])("keeps Escape with an available overlay: %j", (overlay) => {
  render(overlay);
  expect(hasVisibleEscapeOverlay()).toBe(true);
});

it.each([
  { className: "MuiModal-hidden" },
  { hidden: true },
  { inert: "" },
  { "aria-hidden": "true" as const },
  { style: { display: "none" } },
  { style: { visibility: "hidden" as const } },
  { style: { visibility: "collapse" as const } },
])("ignores an overlay hidden by itself or an ancestor: %j", (props) => {
  const overlay = <ul role="menu">Closed menu</ul>;
  const { rerender } = render(<ul role="menu" {...props} />);
  expect(hasVisibleEscapeOverlay()).toBe(false);
  rerender(
    <div {...props}>
      <div>{overlay}</div>
    </div>,
  );
  expect(hasVisibleEscapeOverlay()).toBe(false);
  rerender(
    <>
      <div {...props}>{overlay}</div>
      <ul role="listbox">Open select options</ul>
    </>,
  );
  expect(hasVisibleEscapeOverlay()).toBe(true);
});

it("lets an overlay owner ignore its own surface while respecting a separate modal", () => {
  const { rerender } = render(
    <aside aria-label="Rail">
      <section data-escape-overlay="true">Preview</section>
    </aside>,
  );
  expect(hasVisibleEscapeOverlay()).toBe(true);
  expect(
    hasVisibleEscapeOverlay(
      screen.getByRole("complementary", { name: "Rail" }),
    ),
  ).toBe(false);
  rerender(
    <>
      <aside aria-label="Rail">
        <section data-escape-overlay="true">Preview</section>
      </aside>
      <div className="MuiModal-root">Help</div>
    </>,
  );
  expect(
    hasVisibleEscapeOverlay(
      screen.getByRole("complementary", { name: "Rail" }),
    ),
  ).toBe(true);
});
