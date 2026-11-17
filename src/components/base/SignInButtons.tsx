import { useRef, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import AppleIcon from "@mui/icons-material/Apple";
import GoogleIcon from "@mui/icons-material/Google";
import { login, SignInOptions, SignInProvider } from "../../Globals";
import MailingListCheckbox from "./MailingListCheckbox";

/** Keep both account providers together, including in narrow dialogs. */
export default function SignInButtons({
  disabled = false,
  onSignIn = login,
}: {
  disabled?: boolean;
  onSignIn?: (options: SignInOptions) => Promise<boolean>;
}): React.JSX.Element {
  const pending = useRef(false);
  const [mailingList, setMailingList] = useState(false);
  const [busy, setBusy] = useState<SignInProvider>();
  const [error, setError] = useState(false);
  const signIn = async (provider: SignInProvider) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(provider);
    setError(false);
    try {
      if (!(await onSignIn({ provider, mailingList }))) setError(true);
    } catch {
      setError(true);
    } finally {
      pending.current = false;
      setBusy(undefined);
    }
  };
  return (
    <Box sx={{ width: "100%", maxWidth: 400, minWidth: 0 }}>
      <MailingListCheckbox
        checked={mailingList}
        onChange={setMailingList}
        disabled={disabled || !!busy}
      />
      <Box
        role="group"
        aria-label="Sign in"
        aria-busy={!!busy}
        sx={{
          display: "grid",
          mt: 1,
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 1,
        }}
      >
        {(["google", "apple"] as const).map((provider) => {
          const label = `Sign in with ${provider === "google" ? "Google" : "Apple"}`;
          return (
            <Button
              key={provider}
              variant="outlined"
              color="primary"
              startIcon={provider === "google" ? <GoogleIcon /> : <AppleIcon />}
              disabled={disabled || !!busy}
              aria-label={label}
              onClick={() => void signIn(provider)}
              sx={{
                minWidth: 0,
                minHeight: 44,
                lineHeight: 1.4,
                "& .MuiButton-startIcon": { flexShrink: 0 },
              }}
            >
              <span className="signInLabel">
                {busy === provider ? "Signing in…" : label}
              </span>
            </Button>
          );
        })}
      </Box>
      {error && (
        <Typography role="alert" color="error" variant="body2" sx={{ mt: 1 }}>
          Couldn't finish sign-in. Try again, or use the provider you used
          before.
        </Typography>
      )}
    </Box>
  );
}
