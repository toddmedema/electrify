import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CreditsDialog from "./CreditsDialog";

jest.mock("../../Desktop", () => ({ isDesktopApp: () => true }));

const originalDesktop = process.env.REACT_APP_DESKTOP;

beforeEach(() => {
  process.env.REACT_APP_DESKTOP = "true";
});

afterEach(() => {
  process.env.REACT_APP_DESKTOP = originalDesktop;
});

it("displays desktop privacy offline and closes the credits", async () => {
  const onClose = jest.fn();
  render(<CreditsDialog onClose={onClose} />);
  expect(
    screen.getByRole("heading", { name: "Desktop privacy" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/no Google sign-in or Firebase analytics/),
  ).not.toBeVisible();
  await userEvent.click(screen.getByText("Desktop privacy"));
  expect(
    screen.getByText(/no Google sign-in or Firebase analytics/),
  ).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
