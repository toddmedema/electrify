import * as React from "react";
import {
  Alert,
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

interface Notice {
  title: string;
  text: string;
}

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

function NoticeDetails({ notice }: { notice: Notice }) {
  return (
    <Box component="details" sx={disclosureStyles}>
      <Box component="summary">
        <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
          {notice.title}
        </Box>
        <ChevronDownGlyph className="creditsDisclosureIcon" fontSize="small" />
      </Box>
      <Typography
        component="pre"
        variant="body2"
        sx={{
          m: 0,
          pt: 0.5,
          pb: 2,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          fontFamily: "inherit",
          lineHeight: 1.65,
          color: "text.secondary",
        }}
      >
        {notice.text}
      </Typography>
    </Box>
  );
}

function ChromiumNotices() {
  const [notices, setNotices] = React.useState<Notice[]>();
  const [failed, setFailed] = React.useState(false);
  const requested = React.useRef(false);
  const load = () => {
    if (requested.current) return;
    requested.current = true;
    void fetch(`${process.env.PUBLIC_URL || ""}/notices-chromium.html`)
      .then((response) => {
        if (!response.ok) throw new Error("Chromium notices unavailable");
        return response.text();
      })
      .then((html) => {
        // Parse as inert text. The runtime's original chrome:// styles and scripts
        // never execute, and no iframe or remote navigation is needed.
        const document = new DOMParser().parseFromString(html, "text/html");
        const entries = Array.from(document.querySelectorAll(".product")).map(
          (product) => ({
            title:
              product.querySelector(".title")?.textContent ||
              "Chromium component",
            text: product.querySelector(".license")?.textContent || "",
          }),
        );
        if (!entries.length || entries.some((entry) => !entry.text.trim()))
          throw new Error("Invalid Chromium notices");
        setNotices(entries);
      })
      .catch(() => setFailed(true));
  };
  return (
    <Box component="details" sx={disclosureStyles}>
      <Box component="summary" onClick={load}>
        <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
          Chromium third-party licenses
        </Box>
        <ChevronDownGlyph className="creditsDisclosureIcon" fontSize="small" />
      </Box>
      {!notices && !failed && (
        <Typography role="status">Loading bundled notices…</Typography>
      )}
      {failed && (
        <Alert severity="error">
          Chromium notices could not be loaded. The original
          LICENSES.chromium.html is also included with the desktop runtime.
        </Alert>
      )}
      {notices?.map((notice, index) => (
        <NoticeDetails key={`${notice.title}:${index}`} notice={notice} />
      ))}
    </Box>
  );
}

export default function CreditsDialog({ onClose }: { onClose: () => void }) {
  const [notices, setNotices] = React.useState<Notice[]>();
  const [chromium, setChromium] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    void fetch(`${process.env.PUBLIC_URL || ""}/notices.json`)
      .then((response) => {
        if (!response.ok) throw new Error("Notices unavailable");
        return response.json();
      })
      .then((data: { notices: Notice[]; chromium: boolean }) => {
        if (live) {
          setNotices(data.notices);
          setChromium(data.chromium);
        }
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);
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
          Clause. Third-party components and assets retain their own terms
          below.
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
        <Typography component="h2" variant="subtitle2" sx={{ mb: 0.5 }}>
          Bundled licenses
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Expand an entry to read its full terms.
        </Typography>
        {!notices && !failed && (
          <Typography role="status">Loading bundled notices…</Typography>
        )}
        {failed && (
          <Alert severity="error">
            The bundled notices could not be loaded. Close and reopen this
            window to try again.
          </Alert>
        )}
        {notices?.map((notice, index) => (
          <NoticeDetails key={`${notice.title}:${index}`} notice={notice} />
        ))}
        {chromium && <ChromiumNotices />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained" sx={{ minWidth: 88 }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
