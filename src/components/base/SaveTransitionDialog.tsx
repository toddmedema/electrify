import { useEffect, useState } from "react";
import {
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import { useAppSelector } from "../../Store";

/** Delay the feedback for fast local writes; the coordinator fences input immediately. */
export default function SaveTransitionDialog() {
  const transitioning = useAppSelector((state) => !!state.saves.transitioning);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!transitioning) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(timer);
  }, [transitioning]);
  return (
    <Dialog
      open={transitioning && visible}
      aria-labelledby="save-transition-title"
    >
      <DialogTitle id="save-transition-title">Saving your game…</DialogTitle>
      <DialogContent>
        <div
          style={{ display: "flex", alignItems: "center", gap: 16 }}
          role="status"
        >
          <CircularProgress
            size={24}
            sx={{ flexShrink: 0 }}
            aria-label="Saving"
          />
          <span>Please wait while your game is saved before leaving.</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
