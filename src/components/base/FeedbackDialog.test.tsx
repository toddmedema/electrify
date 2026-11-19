import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { submitFeedback } from "../../Feedback";
import FeedbackDialog from "./FeedbackDialog";
import FeedbackPrompt from "./FeedbackPrompt";

jest.mock("../../Feedback", () => ({
  ...jest.requireActual("../../Feedback"),
  submitFeedback: jest.fn(),
}));

const submission = jest.mocked(submitFeedback);

beforeEach(() => {
  window.localStorage.clear();
  submission.mockReset();
});

it("retains a failed draft and reuses the request ID on retry", async () => {
  submission
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(undefined);
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: () => "6699734c-5897-47e6-b12f-8a853140f46a" },
  });
  const onClose = jest.fn();
  try {
    render(
      <FeedbackDialog
        context={{ source: "scenario", scenarioId: 101, outcome: "bankrupt" }}
        onClose={onClose}
      />,
    );
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
        {
          requestId: "6699734c-5897-47e6-b12f-8a853140f46a",
          source: "scenario",
          scenarioId: 101,
          outcome: "bankrupt",
          message: "My grid went dark.",
          replyEmail: "",
        },
      ]),
    );
    fireEvent.click(done);
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    if (originalCrypto) {
      Object.defineProperty(globalThis, "crypto", originalCrypto);
    } else {
      Reflect.deleteProperty(globalThis, "crypto");
    }
  }
});

it("offers each milestone once independently and never opens the form automatically", () => {
  const onFeedback = jest.fn();
  const view = render(
    <FeedbackPrompt milestone="first-scenario" onFeedback={onFeedback} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Share feedback" }));
  expect(onFeedback).toHaveBeenCalledTimes(1);
  view.unmount();
  render(<FeedbackPrompt milestone="first-scenario" onFeedback={onFeedback} />);
  expect(screen.queryByRole("button", { name: "Share feedback" })).toBeNull();
  render(<FeedbackPrompt milestone="all-tutorials" />);
  expect(screen.getByText(/How were the tutorials/)).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(onFeedback).toHaveBeenCalledTimes(1);
});
