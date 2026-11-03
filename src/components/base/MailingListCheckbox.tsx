import { Checkbox, FormControlLabel, Typography } from "@mui/material";

export default function MailingListCheckbox({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <FormControlLabel
      sx={{ m: 0, minHeight: 44 }}
      control={
        <Checkbox
          size="small"
          sx={{ width: 44, height: 44, p: 1.5, ml: -1.5, flexShrink: 0 }}
          checked={checked}
          onChange={(_, value) => onChange(value)}
          disabled={disabled}
        />
      }
      label={
        <Typography component="span" variant="body2">
          Join the Electrify mailing list
        </Typography>
      }
    />
  );
}
