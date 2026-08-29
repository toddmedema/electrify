import * as React from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import InstallMobileIcon from "@mui/icons-material/InstallMobile";
import { getPlayedScenarioIds } from "../../LocalStorage";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

interface InstallContextType {
  installPrompt?: BeforeInstallPromptEvent;
  installed: boolean;
  isIos: boolean;
  isIosSafari: boolean;
  snoozed: boolean;
  requestInstall: () => Promise<void>;
  snooze: () => void;
}

const InstallContext = React.createContext<InstallContextType>({
  installed: false,
  isIos: false,
  isIosSafari: false,
  snoozed: false,
  requestInstall: async () => undefined,
  snooze: () => undefined,
});

export function useIsInstalledApp(): boolean {
  return React.useContext(InstallContext).installed || standalone();
}

const INSTALL_SNOOZE_KEY = "installPromptSnoozedAt";
const INSTALL_VISITS_KEY = "installVisits";
const INSTALL_VISIT_COUNTED_KEY = "installVisitCounted";
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

function standalone(): boolean {
  return Boolean(
    (navigator as NavigatorWithStandalone).standalone ||
    window.matchMedia?.("(display-mode: standalone)").matches,
  );
}

function iosDevice(): boolean {
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function InstallPromptProvider(props: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [installPrompt, setInstallPrompt] =
    React.useState<BeforeInstallPromptEvent>();
  const [installed, setInstalled] = React.useState(standalone);
  const [snoozed, setSnoozed] = React.useState(() => {
    const dismissed = Number(localStorage.getItem(INSTALL_SNOOZE_KEY) || 0);
    return Date.now() - dismissed < SNOOZE_MS;
  });
  const isIos = iosDevice();
  const isIosSafari =
    isIos &&
    /Safari/.test(navigator.userAgent) &&
    !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);

  React.useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallPrompt(undefined);
      setInstalled(true);
      localStorage.removeItem(INSTALL_SNOOZE_KEY);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const snooze = React.useCallback(() => {
    localStorage.setItem(INSTALL_SNOOZE_KEY, String(Date.now()));
    setSnoozed(true);
  }, []);

  const requestInstall = React.useCallback(async () => {
    if (!installPrompt) {
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(undefined);
    if (choice.outcome === "dismissed") {
      snooze();
    }
  }, [installPrompt, snooze]);

  return (
    <InstallContext.Provider
      value={{
        installPrompt,
        installed,
        isIos,
        isIosSafari,
        snoozed,
        requestInstall,
        snooze,
      }}
    >
      {props.children}
    </InstallContext.Provider>
  );
}

export default function InstallAppButton(props: {
  label?: string;
  afterMilestone?: boolean;
}): React.JSX.Element | null {
  const install = React.useContext(InstallContext);
  const [instructionsOpen, setInstructionsOpen] = React.useState(false);
  const [repeatVisit] = React.useState(() => {
    let visits = Number(localStorage.getItem(INSTALL_VISITS_KEY) || 0);
    if (!sessionStorage.getItem(INSTALL_VISIT_COUNTED_KEY)) {
      visits += 1;
      localStorage.setItem(INSTALL_VISITS_KEY, String(visits));
      sessionStorage.setItem(INSTALL_VISIT_COUNTED_KEY, "1");
    }
    return visits > 1;
  });
  const iosEligible =
    props.afterMilestone || repeatVisit || getPlayedScenarioIds().length > 0;
  const visible =
    !install.installed &&
    !install.snoozed &&
    Boolean(install.installPrompt || (install.isIos && iosEligible));

  if (!visible) {
    return null;
  }

  const onInstall = async () => {
    if (install.installPrompt) {
      await install.requestInstall();
    } else {
      setInstructionsOpen(true);
    }
  };

  return (
    <>
      <Button
        variant="text"
        color="primary"
        startIcon={<InstallMobileIcon />}
        onClick={onInstall}
      >
        {props.label || "Install app"}
      </Button>
      <Dialog
        open={instructionsOpen}
        onClose={() => setInstructionsOpen(false)}
        aria-labelledby="install-instructions-title"
      >
        <DialogTitle id="install-instructions-title">
          Add Electrify to your Home Screen
        </DialogTitle>
        <DialogContent>
          <Typography>
            {install.isIosSafari
              ? "In Safari, tap Share, choose Add to Home Screen, turn on Open as Web App, then tap Add."
              : "Open this page in Safari, then tap Share and Add to Home Screen. iPhone and iPad browsers can only install web apps through Safari."}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              install.snooze();
              setInstructionsOpen(false);
            }}
          >
            Not now
          </Button>
          <Button
            variant="contained"
            onClick={() => setInstructionsOpen(false)}
          >
            Got it
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
