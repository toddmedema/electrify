import * as React from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import {
  DISPLAY_NAME_MAX_LENGTH,
  suggestDisplayName,
  validateDisplayName,
} from "../../helpers/DisplayName";

export interface StateProps {
  open: boolean;
  // The name the player already has, when they came here to change it rather than to pick a first
  currentName?: string;
  // What the identity provider handed over, used to seed the very first name
  googleDisplayName?: string | null;
}

export interface DispatchProps {
  // Resolves to the reason it couldn't be saved, or undefined once it has been
  onSave: (name: string) => Promise<string | undefined>;
  onClose: () => void;
}

export interface Props extends StateProps, DispatchProps {}

/**
 * Picks the name that shows up on the leaderboard.
 *
 * Its own dialog rather than the shared ui.dialog, which only carries a title and a message: this
 * one has a text field whose error comes back from a Firestore transaction, so it has to be able
 * to fail and stay open.
 */
export default function DisplayNameDialog(props: Props): React.JSX.Element {
  const { open, currentName, googleDisplayName, onSave, onClose } = props;
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [saving, setSaving] = React.useState(false);

  // Seeded when the dialog opens rather than on every render, so typing isn't fought by the prop
  React.useEffect(() => {
    if (open) {
      setName(currentName || suggestDisplayName(googleDisplayName));
      setError(undefined);
      setSaving(false);
    }
  }, [open, currentName, googleDisplayName]);

  const save = () => {
    const invalid = validateDisplayName(name);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    onSave(name).then((failure) => {
      setSaving(false);
      // Left open on failure: a taken name needs another try, not a dismissal
      setError(failure);
      if (!failure) {
        onClose();
      }
    });
  };

  return (
    <Dialog open={open} onClose={onClose} aria-labelledby="display-name-title">
      <DialogTitle id="display-name-title">
        {currentName ? "Change your name" : "Choose your leaderboard name"}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="textSecondary" gutterBottom>
          This is the name other players see next to your high scores.
        </Typography>
        <TextField
          autoFocus
          fullWidth
          margin="dense"
          label="Name"
          value={name}
          error={Boolean(error)}
          helperText={
            error ||
            `3-${DISPLAY_NAME_MAX_LENGTH} characters: letters, numbers, spaces, hyphens and underscores.`
          }
          slotProps={{ htmlInput: { maxLength: DISPLAY_NAME_MAX_LENGTH } }}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setName(e.target.value);
            setError(undefined);
          }}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
              save();
            }
          }}
        />
      </DialogContent>
      <DialogActions>
        {/* Dismissible on purpose. A player who wants to get on with the game can pick a name
            later from Settings, and being held at a form on first login is a good way to lose
            them before they have played anything */}
        <Button color="primary" onClick={onClose} disabled={saving}>
          Not now
        </Button>
        <Button
          color="primary"
          variant="contained"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
