import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../../Store";
import PurchaseReviewDialog, {
  financingShortfallText,
} from "./PurchaseReviewDialog";
import { purchaseTerms } from "../../helpers/Financials";
import { formatMoneyConcise } from "../../helpers/Format";

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof PurchaseReviewDialog>> = {},
) {
  const onPurchase = jest.fn();
  render(
    <Provider store={store}>
      <PurchaseReviewDialog
        open
        title="Build it?"
        cash={1000000}
        buildCost={2000000}
        interestRate={0.05}
        upkeepPerMonth={1000}
        onlineInMonths={12}
        onClose={jest.fn()}
        onPurchase={onPurchase}
        {...overrides}
      />
    </Provider>,
  );
  const button = (label: string) =>
    screen.getByText(label, { selector: "button" });
  return { onPurchase, button };
}

describe("PurchaseReviewDialog", () => {
  it("quotes the same terms the reducer books", () => {
    renderDialog({ refinancedBalance: 500000 });
    const terms = purchaseTerms(2000000, true, 0.05, 500000);
    expect(screen.getByText(/now \+/)).toHaveTextContent(
      `${formatMoneyConcise(terms.downpayment)} now + ${formatMoneyConcise(terms.monthlyPayment)}/mo (5.00% for 30 years)`,
    );
    expect(screen.getByText(/Includes refinancing/)).toBeInTheDocument();
    expect(screen.getByText("Online in")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What is interest rate?" }),
    ).toBeVisible();
  });

  it("gates each option on what it costs now", () => {
    const { button } = renderDialog({ cash: 100000 });
    expect(button("Pay cash")).toBeDisabled();
    expect(button("Take loan")).toBeDisabled();
  });

  it("offers an affordable loan and submits it once however quickly it is clicked", () => {
    const { button, onPurchase } = renderDialog();
    expect(button("Pay cash")).toBeDisabled();
    expect(button("Take loan")).toBeEnabled();
    fireEvent.click(button("Take loan"));
    fireEvent.click(button("Take loan"));
    expect(onPurchase).toHaveBeenCalledTimes(1);
    expect(onPurchase).toHaveBeenCalledWith(true);
  });

  it("keeps transaction fees cash-only for both payment choices", () => {
    const { button } = renderDialog({ cash: 450000, cashOnlyFee: 100000 });
    const terms = purchaseTerms(2000000, true, 0.05);
    expect(button("Take loan")).toBeDisabled();
    expect(screen.getByText(/now \+/)).toHaveTextContent(
      `${formatMoneyConcise(terms.downpayment + 100000)} now + ${formatMoneyConcise(terms.monthlyPayment)}/mo`,
    );
    expect(screen.getByText(/cash-only transaction fee/)).toBeInTheDocument();
  });

  it("offers explicit cancellation without submitting a purchase", () => {
    const onClose = jest.fn();
    const { onPurchase, button } = renderDialog({
      cancelLabel: "Cancel",
      onClose,
    });
    fireEvent.click(button("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPurchase).not.toHaveBeenCalled();
  });

  it("allows retry after the owning purchase API rejects a submission", async () => {
    const rejected = jest.fn().mockResolvedValue(false);
    const { button } = renderDialog({ onPurchase: rejected });
    fireEvent.click(button("Take loan"));
    await waitFor(() => expect(rejected).toHaveBeenCalledTimes(1));
    fireEvent.click(button("Take loan"));
    expect(rejected).toHaveBeenCalledTimes(2);
  });

  it("keeps a submitted purchase open and locked until the owner rejects or accepts it", async () => {
    let settle!: (accepted: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    const onClose = jest.fn();
    const submit = jest.fn().mockReturnValue(pending);
    const { button } = renderDialog({
      onPurchase: submit,
      onClose,
      cancelLabel: "Cancel",
    });
    fireEvent.click(button("Take loan"));
    expect(screen.getByRole("status")).toHaveTextContent("Submitting…");
    for (const label of ["Pay cash", "Take loan", "Cancel"])
      expect(button(label)).toBeDisabled();
    expect(screen.getByRole("button", { name: "close" })).toBeDisabled();
    fireEvent.click(button("Cancel"));
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(button("Take loan"));
    expect(onClose).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
    await act(async () => {
      settle(false);
    });
    expect(button("Take loan")).toBeEnabled();
    expect(button("Cancel")).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(button("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("honors extra gating from the caller", () => {
    const { button } = renderDialog({ cash: 1e9, loanDisabled: true });
    expect(button("Pay cash")).toBeEnabled();
    expect(button("Take loan")).toBeDisabled();
  });
});

describe("financingShortfallText", () => {
  it("names the down payment and the cash on hand only when short", () => {
    expect(financingShortfallText(100, 50)).toBeUndefined();
    expect(financingShortfallText(0, 2000000)).toBe(
      `Need ${formatMoneyConcise(2000000)} down payment · you have ${formatMoneyConcise(0)}`,
    );
  });
});
