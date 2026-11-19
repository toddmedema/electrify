import { FormEvent, useEffect, useId, useRef, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  FEEDBACK_EMAIL_LIMIT,
  FEEDBACK_MESSAGE_LIMIT,
  FeedbackContext,
  submitFeedback,
} from "../../Feedback";

const actionSize = {
  minHeight: 40,
  "@media (pointer: coarse)": { minHeight: 44 },
};

export default function FeedbackDialog({
  context,
  onClose,
}: {
  context: FeedbackContext;
  onClose: () => void;
}) {
  const id = useId();
  const [message, setMessage] = useState("");
  const [replyEmail, setReplyEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "failed" | "sent">(
    "idle",
  );
  const attempt = useRef<{ input: string; id: string }>();
  const sending = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    const email = replyEmail.trim();
    if (!text || sending.current) return;
    sending.current = true;
    setStatus("sending");
    try {
      const input = JSON.stringify([text, email]);
      if (attempt.current?.input !== input) {
        attempt.current = { input, id: crypto.randomUUID() };
      }
      await submitFeedback({
        ...context,
        requestId: attempt.current.id,
        message: text,
        replyEmail: email,
      });
      setStatus("sent");
    } catch {
      setStatus("failed");
    } finally {
      sending.current = false;
    }
  }

  const busy = status === "sending";
  const sent = status === "sent";
  useEffect(() => {
    if (sent) closeButton.current?.focus();
  }, [sent]);

  return (
    <Dialog
      open
      fullWidth
      maxWidth="xs"
      onClose={() => {
        if (!sending.current) onClose();
      }}
      aria-labelledby={`${id}-title`}
      aria-describedby={sent ? `${id}-status` : `${id}-description`}
    >
      <DialogTitle id={`${id}-title`}>Share feedback</DialogTitle>
      <DialogContent>
        <Typography
          id={`${id}-status`}
          className={sent ? undefined : "srOnly"}
          role="status"
        >
          {sent
            ? "Thanks for sharing your feedback."
            : busy
              ? "Sending feedback…"
              : ""}
        </Typography>
        {!sent && (
          <Stack
            component="form"
            id={id}
            onSubmit={handleSubmit}
            spacing={2}
            sx={{ pt: 0.5 }}
          >
            <Typography
              id={`${id}-description`}
              variant="body2"
              color="text.secondary"
            >
              Tell us what worked or what we could improve.
            </Typography>
            <TextField
              autoFocus
              required
              label="Your feedback"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              multiline
              minRows={3}
              maxRows={6}
              disabled={busy}
              slotProps={{ htmlInput: { maxLength: FEEDBACK_MESSAGE_LIMIT } }}
            />
            <TextField
              label="Email for a reply (optional)"
              type="email"
              autoComplete="email"
              value={replyEmail}
              onChange={(event) => setReplyEmail(event.target.value)}
              disabled={busy}
              slotProps={{ htmlInput: { maxLength: FEEDBACK_EMAIL_LIMIT } }}
            />
            {status === "failed" && (
              <Alert severity="error">
                Feedback couldn’t be sent. Your message is still here. Try
                again.
              </Alert>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          ref={closeButton}
          disabled={busy}
          onClick={onClose}
          sx={actionSize}
        >
          {sent ? "Done" : "Cancel"}
        </Button>
        {!sent && (
          <Button
            variant="contained"
            type="submit"
            form={id}
            disabled={busy || !message.trim()}
            sx={actionSize}
          >
            {busy ? "Sending…" : "Send feedback"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
