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

interface Notice {
  title: string;
  text: string;
}

function NoticeDetails({ notice }: { notice: Notice }) {
  return (
    <Box
      component="details"
      sx={{ borderTop: 1, borderColor: "divider", py: 1 }}
    >
      <Box
        component="summary"
        sx={{
          cursor: "pointer",
          minHeight: 44,
          display: "list-item",
          alignContent: "center",
          overflowWrap: "anywhere",
        }}
      >
        {notice.title}
      </Box>
      <Typography
        component="pre"
        variant="body2"
        sx={{
          m: 0,
          py: 1,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          fontFamily: "inherit",
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
    <Box
      component="details"
      sx={{ borderTop: 1, borderColor: "divider", py: 1 }}
    >
      <Box
        component="summary"
        onClick={load}
        sx={{ cursor: "pointer", minHeight: 44, alignContent: "center" }}
      >
        Chromium third-party licenses
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
      maxWidth="md"
      aria-labelledby="credits-title"
    >
      <DialogTitle id="credits-title">Credits and licenses</DialogTitle>
      <DialogContent dividers>
        <Typography component="p" sx={{ mb: 2 }}>
          Coding: Todd Medema. Art: Chris Gebhart. Music: Nicholas Coronado.
        </Typography>
        <Typography component="p" sx={{ mb: 2 }}>
          Electrify is source available under the MIT License with Commons
          Clause. Third-party components and assets retain their own terms
          below.
        </Typography>
        {process.env.REACT_APP_DESKTOP === "true" && isDesktopApp() && (
          <Box component="section" sx={{ mb: 3 }}>
            <Typography component="h2" variant="h6">
              Desktop privacy
            </Typography>
            {steamPrivacy.map((paragraph) => (
              <Typography
                key={paragraph}
                component="p"
                sx={{ mb: 2 }}
                variant="body2"
              >
                {paragraph}
              </Typography>
            ))}
          </Box>
        )}
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
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
