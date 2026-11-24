import { Button, Typography } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopyOutlined";
import "./CoopInviteCode.css";

export default function CoopInviteCode({
  code,
  onCopy,
  onCopyLink,
  prominent,
  disabled,
}: {
  code: string;
  onCopy: () => void;
  onCopyLink?: () => void;
  prominent?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className={
        onCopyLink ? "coopInviteCode coopInviteCodeWithLink" : "coopInviteCode"
      }
    >
      <div className="coopInviteValue">
        <Typography variant="caption" color="text.secondary">
          Invite code
        </Typography>
        <span className="coopInviteDigits">{code}</span>
      </div>
      <Button
        variant={prominent && !onCopyLink ? "contained" : "outlined"}
        onClick={onCopy}
        disabled={disabled}
        startIcon={onCopyLink ? undefined : <ContentCopyIcon />}
      >
        Copy code
      </Button>
      {onCopyLink && (
        <Button variant="contained" onClick={onCopyLink} disabled={disabled}>
          Copy link
        </Button>
      )}
    </div>
  );
}
