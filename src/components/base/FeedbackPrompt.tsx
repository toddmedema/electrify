import { useEffect, useRef, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import { getStorageBoolean, setStorageKeyValue } from "../../LocalStorage";

type Milestone = "all-tutorials" | "first-scenario";

/** A milestone invitation lives in the existing completion UI. */
export default function FeedbackPrompt({
  milestone,
  onFeedback,
}: {
  milestone: Milestone;
  onFeedback?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const claimed = useRef(false);
  useEffect(() => {
    const key = `feedback-prompt-${milestone}`;
    if (claimed.current || getStorageBoolean(key, false)) return;
    claimed.current = true;
    setStorageKeyValue(key, true);
    setVisible(true);
  }, [milestone]);

  if (!visible) return null;

  return (
    <Box
      sx={{
        borderTop: "1px solid",
        borderColor: "divider",
        mt: 2,
        pt: 1,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 1,
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {milestone === "all-tutorials"
          ? "How were the tutorials? We’d love to hear what helped or where you got stuck."
          : "How was your first scenario?"}
      </Typography>
      {onFeedback && (
        <Button onClick={onFeedback} sx={{ minHeight: { xs: 44, sm: 40 } }}>
          Share feedback
        </Button>
      )}
    </Box>
  );
}
