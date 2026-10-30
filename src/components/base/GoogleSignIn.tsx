import { useState } from "react";
import { Button, ButtonProps, Stack } from "@mui/material";
import type { SignInOptions } from "../../Globals";
import MailingListCheckbox from "./MailingListCheckbox";

/** The sign-in button and its optional consent, for places that show them together. */
export default function GoogleSignIn({
  onSignIn,
  label = "Sign in with Google",
  disabled = false,
  centered = false,
  variant = "outlined",
  size,
}: {
  onSignIn: (options: SignInOptions) => unknown;
  label?: string;
  disabled?: boolean;
  centered?: boolean;
} & Pick<ButtonProps, "variant" | "size">): React.JSX.Element {
  const [mailingList, setMailingList] = useState(false);
  return (
    <Stack
      spacing={1}
      sx={{
        flexShrink: 0,
        maxWidth: "100%",
        alignItems: centered ? "center" : undefined,
      }}
    >
      <MailingListCheckbox
        checked={mailingList}
        onChange={setMailingList}
        disabled={disabled}
      />
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => void onSignIn({ mailingList })}
      >
        {label}
      </Button>
    </Stack>
  );
}
