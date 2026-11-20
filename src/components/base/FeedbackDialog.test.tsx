import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { submitFeedback } from "../../Feedback";
import { logEvent } from "../../Globals";
import FeedbackDialog from "./FeedbackDialog";
import FeedbackPrompt from "./FeedbackPrompt";

jest.mock("../../Feedback", () => ({
  ...jest.requireActual("../../Feedback"),
  submitFeedback: jest.fn(),
}));

const submission = jest.mocked(submitFeedback);
let mockAccountEmail: string | undefined;

jest.mock("../../Globals", () => ({
  ...jest.requireActual("../../Globals"),
  firebaseAppAuth: {
    get currentUser() {
      return mockAccountEmail ? { email: mockAccountEmail } : null;
    },
    onAuthStateChanged: () => () => undefined,
  },
  logEvent: jest.fn(),
}));

const requestId = "6699734c-5897-47e6-b12f-8a853140f46a";
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");

beforeAll(() => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: () => requestId },
  });
});

afterAll(() => {
  if (originalCrypto) {
    Object.defineProperty(globalThis, "crypto", originalCrypto);
  } else {
    Reflect.deleteProperty(globalThis, "crypto");
  }
});

beforeEach(() => {
  window.localStorage.clear();
  submission.mockReset();
  jest.mocked(logEvent).mockClear();
  mockAccountEmail = undefined;
});

it("retains a failed draft and reuses the request ID on retry", async () => {
  submission
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(undefined);
  const onClose = jest.fn();
  const context = {
    source: "scenario",
    scenarioId: 101,
    outcome: "bankrupt",
  } as const;
  render(<FeedbackDialog context={context} onClose={onClose} />);
  const message = screen.getByRole("textbox", { name: "Your feedback" });
  fireEvent.change(message, { target: { value: "  My grid went dark.  " } });
  fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(message).toHaveValue("  My grid went dark.  ");

  fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
  const done = await screen.findByRole("button", { name: "Done" });
  await waitFor(() => expect(done).toHaveFocus());
  expect(submission.mock.calls).toEqual(
    Array(2).fill([
      { ...context, requestId, message: "My grid went dark.", replyEmail: "" },
    ]),
  );
  expect(jest.mocked(logEvent).mock.calls).toEqual([
    ["feedback_open", context],
    ["feedback_submit", context],
    ["feedback_submit", context],
  ]);
  fireEvent.click(done);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it.each([true, false])(
  "only includes the account email when the checkbox is %s",
  async (includeAccountEmail) => {
    mockAccountEmail = "player@example.com";
    submission.mockResolvedValueOnce(undefined);
    const context = { source: "game-menu" } as const;
    render(
      <StrictMode>
        <FeedbackDialog context={context} onClose={jest.fn()} />
      </StrictMode>,
    );
    expect(
      screen.queryByRole("textbox", { name: "Email for a reply (optional)" }),
    ).not.toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox", {
      name: "Include account email for a reply (optional)",
    });
    expect(checkbox).toBeChecked();
    if (!includeAccountEmail) fireEvent.click(checkbox);
    fireEvent.change(screen.getByRole("textbox", { name: "Your feedback" }), {
      target: { value: "Feedback from a signed-in player" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    await screen.findByRole("button", { name: "Done" });
    expect(submission).toHaveBeenCalledWith({
      ...context,
      requestId,
      message: "Feedback from a signed-in player",
      replyEmail: includeAccountEmail ? mockAccountEmail : "",
    });
    expect(jest.mocked(logEvent).mock.calls).toEqual([
      ["feedback_open", context],
      ["feedback_submit", context],
    ]);
  },
);

it("offers feedback only on the first scenario result and waits for the player to open it", () => {
  const onFeedback = jest.fn();
  const view = render(<FeedbackPrompt onFeedback={onFeedback} />);
  expect(onFeedback).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Share feedback" }));
  expect(onFeedback).toHaveBeenCalledTimes(1);
  view.unmount();
  render(<FeedbackPrompt onFeedback={onFeedback} />);
  expect(screen.queryByRole("button", { name: "Share feedback" })).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(onFeedback).toHaveBeenCalledTimes(1);
});
