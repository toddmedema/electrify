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
          checked={checked}
          onChange={(_, value) => onChange(value)}
          disabled={disabled}
        />
      }
      label={
        <Typography variant="body2">
          Sign me up for the Electrify mailing list
        </Typography>
      }
    />
  );
}
