/** Reveal only in intentional scroll surfaces, keeping fixed shell chrome in place. */
export function revealControl(
  element: HTMLElement,
  block: "nearest" | "start" = "nearest",
) {
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const style = getComputedStyle(parent);
    const bounds = parent.getBoundingClientRect();
    const target = element.getBoundingClientRect();
    if (/(auto|scroll)/.test(style.overflowY)) {
      const top = bounds.top + parent.clientTop;
      const bottom = top + parent.clientHeight;
      if (block === "start" || target.top < top)
        parent.scrollTop += target.top - top;
      else if (target.bottom > bottom)
        parent.scrollTop += target.bottom - bottom;
    }
    if (/(auto|scroll)/.test(style.overflowX)) {
      const left = bounds.left + parent.clientLeft;
      const right = left + parent.clientWidth;
      if (target.left < left) parent.scrollLeft += target.left - left;
      else if (target.right > right) parent.scrollLeft += target.right - right;
    }
  }
}
