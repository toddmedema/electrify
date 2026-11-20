import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
let mockAuthChanged: (user: { email: string } | null) => void;

jest.mock("../../Globals", () => ({
  ...jest.requireActual("../../Globals"),
  firebaseAppAuth: {
    get currentUser() {
      return mockAccountEmail ? { email: mockAccountEmail } : null;
    },
    onAuthStateChanged: (callback: typeof mockAuthChanged) => {
      mockAuthChanged = callback;
      return () => undefined;
    },
  },
  logEvent: jest.fn(),
}));

const requestId = "6699734c-5897-47e6-b12f-8a853140f46a";
const randomUUID = jest.fn(() => requestId);
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");

beforeAll(() => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID },
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
  randomUUID.mockReset().mockReturnValue(requestId);
});

it.each([
  [undefined, "player@example.com"],
  ["player@example.com", "other@example.com"],
  ["player@example.com", undefined],
])(
  "retries the original payload when auth changes from %s to %s",
  async (before, after) => {
    mockAccountEmail = before;
    submission
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(undefined);
    randomUUID.mockReturnValueOnce(requestId).mockReturnValue("new-request");
    render(
      <FeedbackDialog context={{ source: "game-menu" }} onClose={jest.fn()} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Your feedback" }), {
      target: { value: "Keep my retry together" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    await screen.findByRole("alert");
    act(() => mockAuthChanged(after ? { email: after } : null));
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    await screen.findByRole("button", { name: "Done" });
    expect(submission.mock.calls[1]).toEqual(submission.mock.calls[0]);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  },
);

it.each(["message", "reply email", "account-email checkbox"])(
  "creates a new attempt when the player edits the %s",
  async (field) => {
    mockAccountEmail =
      field === "account-email checkbox" ? "player@example.com" : undefined;
    submission
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    randomUUID.mockReturnValueOnce(requestId).mockReturnValue("new-request");
    render(
      <FeedbackDialog context={{ source: "game-menu" }} onClose={jest.fn()} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Your feedback" }), {
      target: { value: "Original message" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    await screen.findByRole("alert");
    if (field === "account-email checkbox") {
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: "Include account email for a reply (optional)",
        }),
      );
    } else {
      fireEvent.change(
        screen.getByRole("textbox", {
          name:
            field === "message"
              ? "Your feedback"
              : "Email for a reply (optional)",
        }),
        {
          target: {
            value: field === "message" ? "Edited message" : "reply@example.com",
          },
        },
      );
    }
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    await screen.findByRole("button", { name: "Done" });
    expect(submission.mock.calls[1][0]).toMatchObject({
      requestId: "new-request",
      message: field === "message" ? "Edited message" : "Original message",
      replyEmail: field === "reply email" ? "reply@example.com" : "",
    });
  },
);

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
