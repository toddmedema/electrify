import { fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../../Store";
import { createGame } from "../../testing/Simulator";
import InvestmentPlanner from "./InvestmentPlanner";
import { createInvestmentPreviewWorker } from "../../helpers/InvestmentPreviewClient";

jest.mock("../../helpers/InvestmentPreviewClient", () => ({
  createInvestmentPreviewWorker: jest.fn(),
}));

test("mixed-plan editing invalidates pending workers and closing restores a clean sandbox", () => {
  const fake = {
    postMessage: jest.fn(),
    terminate: jest.fn(),
    onmessage: undefined as undefined | ((event: { data: unknown }) => void),
  };
  (createInvestmentPreviewWorker as jest.Mock).mockReturnValue(fake);
  const game = createGame({ scenarioId: 106 });
  render(
    <Provider store={store}>
      <InvestmentPlanner game={game} />
    </Provider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Test an investment plan" }),
  );
  const dialog = screen.getByRole("dialog");
  const choose = (label: string, option: string) => {
    fireEvent.mouseDown(within(dialog).getByRole("combobox", { name: label }));
    fireEvent.click(screen.getByRole("option", { name: option }));
  };
  choose("Facility", "Solar");
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Add to plan (0/8)" }),
  );
  choose("Asset type", "Storage");
  choose("Facility", "Battery");
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Add to plan (1/8)" }),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Compare plan" }));
  expect(fake.postMessage.mock.calls[0][0].purchases).toHaveLength(2);
  const receive = fake.onmessage!;
  fireEvent.click(
    within(dialog).getByRole("button", { name: /Remove purchase 2/ }),
  );
  expect(fake.terminate).toHaveBeenCalled();
  receive({ data: { error: "Stale response" } });
  expect(screen.queryByText("Stale response")).not.toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Test an investment plan" }),
  );
  expect(
    screen.queryByRole("region", { name: "Proposed purchases" }),
  ).not.toBeInTheDocument();
});
