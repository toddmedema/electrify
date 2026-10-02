import * as React from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { normalizeSaveName, SAVE_NAME_LIMIT } from "../../SaveModel";
import { renameSavedGame } from "../../SaveSession";

export default function RenameSaveDialog(props: {
  save?: { id: string; name: string };
  onClose: () => void;
}): React.JSX.Element {
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    setName(props.save?.name || "");
    setError("");
  }, [props.save?.id, props.save?.name]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!props.save || saving) return;
    try {
      const normalized = normalizeSaveName(name);
      setSaving(true);
      await renameSavedGame(props.save.id, normalized);
      props.onClose();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Couldn't rename this save.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={!!props.save}
      onClose={saving ? undefined : props.onClose}
      fullWidth
      maxWidth="xs"
      aria-labelledby="rename-save-title"
      slotProps={{
        transition: {
          onEntered: () => {
            input.current?.focus();
            input.current?.select();
          },
        },
      }}
    >
      <form onSubmit={submit}>
        <DialogTitle id="rename-save-title">Rename saved game</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            inputRef={input}
            fullWidth
            margin="dense"
            label="Save name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError("");
            }}
            error={!!error}
            helperText={
              error ||
              `${Array.from(name.trim()).length}/${SAVE_NAME_LIMIT} characters. Duplicate names are allowed.`
            }
            disabled={saving}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={props.onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={saving}>
            {saving ? "Renaming…" : "Rename"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
