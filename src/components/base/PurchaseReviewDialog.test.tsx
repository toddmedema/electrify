import { fireEvent, render, screen } from "@testing-library/react";
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
  });

  it("gates each option on what it costs now", () => {
    const { button } = renderDialog({ cash: 100000 });
    expect(button("Pay cash")).toBeDisabled();
    expect(button("Take loan")).toBeDisabled();
  });

  it("offers only the loan when the full price is out of reach", () => {
    const { button } = renderDialog();
    expect(button("Pay cash")).toBeDisabled();
    expect(button("Take loan")).toBeEnabled();
  });

  it("submits once however quickly the loan is clicked", () => {
    const { button, onPurchase } = renderDialog();
    fireEvent.click(button("Take loan"));
    fireEvent.click(button("Take loan"));
    expect(onPurchase).toHaveBeenCalledTimes(1);
    expect(onPurchase).toHaveBeenCalledWith(true);
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
