import { useEffect, useRef, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import { getStorageBoolean, setStorageKeyValue } from "../../LocalStorage";

/** Invite feedback once, within the first scenario result. */
export default function FeedbackPrompt({
  onFeedback,
}: {
  onFeedback: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const claimed = useRef(false);
  useEffect(() => {
    const key = "feedback-prompt-first-scenario";
    if (claimed.current || getStorageBoolean(key, false)) return;
    claimed.current = true;
    setStorageKeyValue(key, true);
    setVisible(true);
  }, []);

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
        justifyContent: "center",
        gap: 1,
      }}
    >
      <Typography variant="body2" color="text.secondary">
        How was your first scenario?
      </Typography>
      <Button onClick={onFeedback} sx={{ minHeight: { xs: 44, sm: 40 } }}>
        Share feedback
      </Button>
    </Box>
  );
}
