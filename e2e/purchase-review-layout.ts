import { expect, type Locator } from "@playwright/test";

/** Compare both purchases against the real facility dialog, including responsive reflow. */
export async function expectPurchaseFactTable(
  dialog: Locator,
  labels: string[],
  reference?: Awaited<ReturnType<typeof purchaseFactStyle>>,
  tableLabel = "Expected impact",
) {
  const table = dialog.getByRole("region", {
    name: tableLabel,
    exact: true,
  });
  const rows = table.locator(".decisionImpactFact");
  await expect(rows.locator(".decisionImpactFactLabel")).toHaveText(labels);
  for (const row of await rows.all()) {
    if (
      await row.evaluate((element) =>
        element.classList.contains("decisionImpactFactMoney"),
      )
    ) {
      await expect(row.locator(":scope > .conceptIcon")).toHaveCount(0);
      await expect(row.locator(".decisionImpactFactValue")).toContainText("$");
    } else {
      await expect(row.locator(":scope > .conceptIcon")).toBeVisible();
    }
  }
  const style = await purchaseFactStyle(table);
  if (reference) expect(style).toEqual(reference);
  await expect(dialog.locator(".MuiDialogActions-root button")).toHaveText([
    "Pay cash",
    "Take loan",
  ]);
  return style;
}

async function purchaseFactStyle(table: Locator) {
  return table.evaluate((section) => {
    const paper = section.closest('[role="dialog"]')!;
    const origin = paper.getBoundingClientRect();
    const rows = Array.from(section.querySelectorAll(".decisionImpactFact"));
    const offset = (element: Element) =>
      Math.round((element.getBoundingClientRect().left - origin.left) * 100) /
      100;
    const textStyle = (element: Element) => {
      const style = getComputedStyle(element);
      return {
        size: style.fontSize,
        weight: style.fontWeight,
        lineHeight: style.lineHeight,
        color: style.color,
      };
    };
    const first = rows[0];
    const label = first.querySelector(".decisionImpactFactLabel")!;
    const value = first.querySelector(".decisionImpactFactValue")!;
    const columns = { label: offset(label), value: offset(value) };
    // Every row uses the same columns even if it has help or wraps to several lines.
    for (const row of rows) {
      const rowLabel = row.querySelector(".decisionImpactFactLabel")!;
      const rowValue = row.querySelector(".decisionImpactFactValue")!;
      if (
        offset(rowLabel) !== columns.label ||
        offset(rowValue) !== columns.value
      )
        throw new Error(
          "Purchase facts do not share aligned label/value columns",
        );
    }
    const rowStyle = getComputedStyle(first);
    return {
      columns,
      label: textStyle(label),
      value: textStyle(value.querySelector("strong")!),
      icon: textStyle(
        section.querySelector(".decisionImpactFact > .conceptIcon")!,
      ),
      padding: rowStyle.padding,
      gap: rowStyle.gap,
      border: rowStyle.borderTop,
    };
  });
}
