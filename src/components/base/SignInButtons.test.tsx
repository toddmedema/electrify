import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { login } from "../../Globals";
import SignInButtons from "./SignInButtons";

jest.mock("../../Globals", () => ({ login: jest.fn() }));
const mockLogin = login as jest.MockedFunction<typeof login>;

beforeEach(() => jest.resetAllMocks());

it.each(["google", "apple"] as const)(
  "signs in with %s and prevents concurrent attempts",
  async (provider) => {
    let finish!: (ok: boolean) => void;
    mockLogin.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<SignInButtons />);
    await userEvent.click(
      screen.getByRole("button", {
        name: `Sign in with ${provider === "google" ? "Google" : "Apple"}`,
      }),
    );
    expect(mockLogin).toHaveBeenCalledWith({ provider, mailingList: false });
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("group", { name: "Sign in" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await act(async () => finish(true));
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  },
);

it("allows switching providers after cancellation or failure", async () => {
  mockLogin
    .mockResolvedValueOnce(false)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(true);
  render(<SignInButtons />);
  await userEvent.click(
    screen.getByRole("button", { name: "Sign in with Apple" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn't finish sign-in",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Sign in with Google" }),
  );
  expect(await screen.findByRole("alert")).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Sign in with Apple" }),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(mockLogin.mock.calls).toEqual([
    [{ provider: "apple", mailingList: false }],
    [{ provider: "google", mailingList: false }],
    [{ provider: "apple", mailingList: false }],
  ]);
});

it("disables both providers when sign-in is unavailable", () => {
  render(<SignInButtons disabled />);
  for (const button of screen.getAllByRole("button"))
    expect(button).toBeDisabled();
});

it.each(["google", "apple"] as const)(
  "uses the current explicit consent for %s and resets on remount",
  async (provider) => {
    mockLogin.mockResolvedValue(true);
    const view = render(<SignInButtons />);
    const checkbox = screen.getByRole("checkbox", {
      name: "Join the Electrify mailing list",
    });
    const button = screen.getByRole("button", {
      name: `Sign in with ${provider === "google" ? "Google" : "Apple"}`,
    });
    expect(checkbox).not.toBeChecked();
    await userEvent.click(button);
    expect(mockLogin).toHaveBeenLastCalledWith({
      provider,
      mailingList: false,
    });
    await userEvent.click(checkbox);
    await userEvent.click(button);
    expect(mockLogin).toHaveBeenLastCalledWith({ provider, mailingList: true });
    await userEvent.click(checkbox);
    await userEvent.click(button);
    expect(mockLogin).toHaveBeenLastCalledWith({
      provider,
      mailingList: false,
    });
    view.unmount();
    render(<SignInButtons />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  },
);
