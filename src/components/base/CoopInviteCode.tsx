import { Button, Typography } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopyOutlined";
import "./CoopInviteCode.css";

export default function CoopInviteCode({
  code,
  onCopy,
  prominent,
  disabled,
}: {
  code: string;
  onCopy: () => void;
  prominent?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="coopInviteCode">
      <div className="coopInviteValue">
        <Typography variant="caption" color="text.secondary">
          Invite code
        </Typography>
        <span className="coopInviteDigits">{code}</span>
      </div>
      <Button
        variant={prominent ? "contained" : "outlined"}
        onClick={onCopy}
        disabled={disabled}
        startIcon={<ContentCopyIcon />}
      >
        Copy code
      </Button>
    </div>
  );
}
