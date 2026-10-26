import * as React from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import steamPrivacy from "../../legal/SteamPrivacy.json";
import { isDesktopApp } from "../../Desktop";
import { ChevronDownGlyph } from "./Glyphs";

const disclosureStyles = {
  borderTop: 1,
  borderColor: "divider",
  "& > summary": {
    boxSizing: "border-box",
    cursor: "pointer",
    minHeight: 48,
    py: 1.5,
    display: "flex",
    alignItems: "center",
    gap: 1.5,
    listStyle: "none",
    overflowWrap: "anywhere",
    "&::-webkit-details-marker": { display: "none" },
    "&:hover": { color: "primary.main" },
    "&:focus-visible": {
      outline: "2px solid",
      outlineColor: "primary.main",
      outlineOffset: 2,
      borderRadius: 1,
    },
  },
  "& > summary .creditsDisclosureIcon": {
    flexShrink: 0,
    color: "text.secondary",
    transform: "rotate(-90deg)",
  },
  "&[open] > summary .creditsDisclosureIcon": { transform: "none" },
};

export default function CreditsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="credits-title"
    >
      <DialogTitle id="credits-title">Credits and licenses</DialogTitle>
      <DialogContent dividers sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
        <Box
          component="dl"
          aria-label="Contributors"
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" },
            gap: { xs: 1.5, sm: 2 },
            m: 0,
            mb: 3,
          }}
        >
          {[
            ["Coding", "Todd Medema"],
            ["Art", "Chris Gebhart"],
            ["Music", "Nicholas Coronado"],
          ].map(([role, name]) => (
            <Box
              key={role}
              sx={{
                display: { xs: "grid", sm: "block" },
                gridTemplateColumns: "64px minmax(0, 1fr)",
                alignItems: "baseline",
                gap: 1,
              }}
            >
              <Typography component="dt" variant="body2" color="text.secondary">
                {role}
              </Typography>
              <Typography component="dd" sx={{ m: 0, fontWeight: 600 }}>
                {name}
              </Typography>
            </Box>
          ))}
        </Box>
        <Typography
          component="p"
          variant="body2"
          color="text.secondary"
          sx={{ mb: 3, lineHeight: 1.6 }}
        >
          Electrify is source available under the MIT License with Commons
          Clause. Third-party components and assets retain their own terms.
        </Typography>
        {process.env.REACT_APP_DESKTOP === "true" && isDesktopApp() && (
          <Box
            component="details"
            sx={{
              ...disclosureStyles,
              mb: 3,
              borderBottom: 1,
              borderBottomColor: "divider",
            }}
          >
            <Box component="summary">
              <Typography component="h2" variant="subtitle2" sx={{ flex: 1 }}>
                Desktop privacy
              </Typography>
              <ChevronDownGlyph
                className="creditsDisclosureIcon"
                fontSize="small"
              />
            </Box>
            <Box sx={{ pb: 1 }}>
              {steamPrivacy.map((paragraph) => (
                <Typography
                  key={paragraph}
                  component="p"
                  sx={{ mb: 2, lineHeight: 1.65, overflowWrap: "anywhere" }}
                  variant="body2"
                  color="text.secondary"
                >
                  {paragraph}
                </Typography>
              ))}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained" sx={{ minWidth: 88 }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
