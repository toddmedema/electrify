import { useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import { getDesktop } from "../Desktop";
import type { DesktopInputFrame } from "../Desktop";
import type { MatchSpec, Seat, World } from "../multiplayer/Types";
import { coopControls, registerCoopControls } from "../multiplayer/Registry";
import { navigate } from "../reducers/Card";
import { delta as uiDelta } from "../reducers/UI";
import { store } from "../Store";
import { getScenario } from "../data/Scenarios";
import { registerShutdownCheckpoint } from "../desktop/Shutdown";
import type { CouchSummary } from "./Protocol";
import SettingsContainer from "../components/views/SettingsContainer";
import { beginCouchPlatform } from "./Platform";
import { nextControllerSeat } from "./Bindings";
import { formatHour } from "../helpers/DateTime";
import "./couch.scss";

type Device = DesktopInputFrame & { id: string };
type NativeEvent = {
  kind: string;
  seatId: string;
  generation: number;
  message?: unknown;
  reason?: string;
  devices?: Device[];
  layout?: { fits: boolean };
  open?: boolean;
  id?: string;
};
type Saved = { id: string; name: string; updatedAt: number; players: Seat[] };
const defaultSeats: Seat[] = [
  { id: "local-p1", name: "P1 Utility" },
  { id: "local-p2", name: "P2 Utility" },
];

/** The shell owns the worker and persistence; native binds every inbound seat route. */
export default function CouchRoot({ onClose }: { onClose: () => void }) {
  const desktop = getDesktop()!;
  const request = (input: Record<string, unknown>) =>
    desktop.couchRequest!(input);
  const [seats, setSeats] = useState<Seat[]>(defaultSeats);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [devices, setDevices] = useState<Device[]>([]);
  const [stage, setStage] = useState<"join" | "choose" | "confirm" | "play">(
    "join",
  );
  const [spec, setSpec] = useState<MatchSpec>();
  const [saved, setSaved] = useState<World>();
  const [library, setLibrary] = useState<Saved[]>([]);
  const [deleting, setDeleting] = useState<Saved>();
  const [saveFailed, setSaveFailed] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [ready, setReady] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveTime, setSaveTime] = useState<number>();
  const [summary, setSummary] = useState<CouchSummary>();
  const [exitOwner, setExitOwner] = useState<string>();
  const [recovery, setRecovery] = useState<string[]>([]);
  const [invalidLayout, setInvalidLayout] = useState(false);
  const [textOwner, setTextOwner] = useState<string>();
  const [settingsOwner, setSettingsOwner] = useState<string>();
  const [sessionFault, setSessionFault] = useState(false);
  const [blockers, setBlockers] = useState<readonly string[]>([]);
  const globalRequest = useRef<{
    kind: "leave" | "settings" | "text";
    seatId: string;
    generation: number;
    id: string;
  }>();
  const routes = useRef(new Map<string, number>());
  const platform = useRef<ReturnType<typeof beginCouchPlatform>>();
  const mounted = useRef(false);
  const starts = useRef(0);
  const leaveRequest = useRef<{
    seatId: string;
    generation: number;
    requestId: string;
  }>();
  const band = useRef<HTMLDivElement>(null);
  const coordinator = useRef<import("./Coordinator").CouchCoordinator>();
  const current = useRef({
    seats,
    bindings,
    stage,
    ready,
    summary,
    saved,
    exitOwner,
    busy,
  });
  current.current = {
    seats,
    bindings,
    stage,
    ready,
    summary,
    saved,
    exitOwner,
    busy,
  };

  const close = async () => {
    starts.current++;
    coordinator.current?.dispose();
    coordinator.current = undefined;
    await request({ kind: "close" });
    store.dispatch(uiDelta({ coop: undefined }));
    store.dispatch(navigate("MAIN_MENU"));
    onClose();
  };
  const cancelGlobal = (message: string) => {
    const active = globalRequest.current;
    if (active?.kind === "leave")
      coordinator.current?.resolveLeave(
        active.seatId,
        active.generation,
        active.id,
        message,
      );
    globalRequest.current = undefined;
    leaveRequest.current = undefined;
    setExitOwner(undefined);
    setSettingsOwner(undefined);
    coordinator.current?.setInputGate("global-request", false);
  };
  const gateGlobal = () => {
    coordinator.current?.setInputGate("global-request", true);
    coordinator.current?.setBlocker("global-dialog", "TV session dialog open");
  };
  const requestExit = (seatId: string) => {
    if (globalRequest.current || current.current.busy) return;
    globalRequest.current = {
      kind: "leave",
      seatId,
      generation: routes.current.get(seatId) ?? 0,
      id: crypto.randomUUID(),
    };
    gateGlobal();
    setExitOwner(seatId);
    setSaveFailed(false);
    setDiscarding(false);
  };
  const returnToSetup = async () => {
    starts.current++;
    setBusy(false);
    platform.current?.dispose();
    platform.current = beginCouchPlatform();
    coordinator.current?.dispose();
    coordinator.current = undefined;
    await request({ kind: "close" });
    routes.current.clear();
    globalRequest.current = undefined;
    leaveRequest.current = undefined;
    setBindings({});
    setReady([]);
    setSummary(undefined);
    setRecovery([]);
    setInvalidLayout(false);
    setSessionFault(false);
    setSettingsOwner(undefined);
    setExitOwner(undefined);
    setTextOwner(undefined);
    setSaved(undefined);
    setSpec(undefined);
    setSeats(defaultSeats);
    setStage("join");
    store.dispatch(uiDelta({ coop: undefined }));
    store.dispatch(navigate("MAIN_MENU"));
    await request({ kind: "setup" });
    const library = (await request({ kind: "list-saves" })) as {
      slots?: Saved[];
    };
    setLibrary(library.slots ?? []);
  };
  useEffect(() => {
    mounted.current = true;
    const startCounter = starts;
    platform.current = beginCouchPlatform();
    const previous = coopControls();
    let live = true;
    const stop = desktop.onCouchEvent!((input) => {
      const event = input as NativeEvent;
      if (event.kind === "devices") {
        const next = event.devices ?? [];
        setDevices(next);
        const state = current.current;
        const connected = new Set(
          next.filter((device) => device.connected).map((device) => device.id),
        );
        const retired = new Set(
          state.summary
            ? state.summary.players
                .filter((player) => player.retired)
                .map((player) => player.id)
            : Object.keys(state.saved?.outcomes ?? {}),
        );
        if (
          (state.stage === "choose" || state.stage === "confirm") &&
          state.seats.some(
            (seat) =>
              !retired.has(seat.id) &&
              state.bindings[seat.id] &&
              !connected.has(state.bindings[seat.id]),
          )
        ) {
          setReady([]);
          setStage("join");
          store.dispatch(uiDelta({ coop: undefined }));
          store.dispatch(navigate("MAIN_MENU"));
          setError(
            "A controller disconnected. Explicitly reassign the missing company before choosing or resuming.",
          );
          return;
        }
        const activeGlobal = globalRequest.current;
        if (
          activeGlobal &&
          activeGlobal.kind !== "text" &&
          !state.busy &&
          !next.some(
            (device) =>
              device.id === state.bindings[activeGlobal.seatId] &&
              device.connected,
          )
        )
          cancelGlobal("The requesting controller disconnected");
        if (
          state.exitOwner &&
          !next.some(
            (device) =>
              device.id === state.bindings[state.exitOwner!] &&
              device.connected,
          )
        ) {
          if (!state.busy) {
            const pending = leaveRequest.current;
            if (pending)
              coordinator.current?.resolveLeave(
                pending.seatId,
                pending.generation,
                pending.requestId,
                "The requesting controller disconnected",
              );
            leaveRequest.current = undefined;
            setExitOwner(undefined);
          } else
            setError(
              "The requesting controller disconnected while saving. The complete checkpoint is still being written.",
            );
        }
        if (state.stage === "play") {
          for (const seat of state.seats) {
            const connected = next.some(
              (device) =>
                device.id === state.bindings[seat.id] && device.connected,
            );
            const retired = state.summary?.players.find(
              (player) => player.id === seat.id,
            )?.retired;
            coordinator.current?.setBlocker(
              `controller:${seat.id}`,
              connected || retired
                ? null
                : `${seat.name}: Controller disconnected`,
              !connected && !retired,
            );
          }
        }
        for (const device of next) {
          if (!device.actions.includes("confirm")) continue;
          const assigned = Object.entries(state.bindings).find(
            ([, id]) => id === device.id,
          )?.[0];
          if (!assigned && (state.stage === "join" || state.stage === "play")) {
            const free = nextControllerSeat(
              state.seats,
              state.bindings,
              connected,
              retired,
            );
            if (free) {
              state.bindings = { ...state.bindings, [free.id]: device.id };
              setBindings(state.bindings);
              void request({
                kind: "bind",
                seatId: free.id,
                controllerId: device.id,
              })
                .then(() => {
                  coordinator.current?.setBlocker(
                    `controller:${free.id}`,
                    null,
                  );
                  if (state.stage === "play")
                    coordinator.current?.requireReady(
                      `${free.name}: replacement controller assigned. Everyone select a speed to resume.`,
                    );
                })
                .catch((failure) => setError(String(failure)));
            }
          } else if (assigned && state.stage === "confirm") {
            setReady((value) =>
              value.includes(assigned) ? value : [...value, assigned],
            );
          }
        }
      } else if (event.kind === "seat-attached") {
        routes.current.set(event.seatId, event.generation);
        setRecovery((value) => value.filter((id) => id !== event.seatId));
        coordinator.current?.attachSeat(
          event.seatId,
          event.generation,
          (message) => {
            void request({
              kind: "send",
              seatId: event.seatId,
              generation: event.generation,
              message,
            });
          },
        );
        void request({
          kind: "send",
          seatId: event.seatId,
          generation: event.generation,
          message: {
            kind: "presentation",
            generation: event.generation,
            settings: store.getState().settings,
          },
        });
      } else if (event.kind === "seat-message") {
        coordinator.current?.receive(
          event.seatId,
          event.generation,
          event.message,
        );
      } else if (event.kind === "seat-lost") {
        if (
          globalRequest.current?.seatId === event.seatId &&
          globalRequest.current.generation === event.generation &&
          !current.current.busy
        )
          cancelGlobal("The requesting seat reconnected");
        routes.current.delete(event.seatId);
        coordinator.current?.detachSeat(event.seatId, event.generation);
        if (
          current.current.summary?.players.find(
            (player) => player.id === event.seatId,
          )?.retired
        )
          return;
        setError(
          `${event.seatId.toUpperCase()}: ${event.reason ?? "Connection lost"}. Reconnect before resuming.`,
        );
        setRecovery((value) =>
          value.includes(event.seatId) ? value : [...value, event.seatId],
        );
      } else if (event.kind === "layout") {
        setInvalidLayout(!event.layout?.fits);
        coordinator.current?.setBlocker(
          "layout",
          event.layout?.fits
            ? null
            : "Restore a display area with at least 360 CSS pixels per company",
          true,
        );
      } else if (event.kind === "global-text") {
        if (event.open) {
          if (current.current.busy) {
            void request({ kind: "cancel-text", requestId: event.id });
            return;
          }
          cancelGlobal(
            "Steam text entry took control of the TV session dialog",
          );
          globalRequest.current = {
            kind: "text",
            seatId: event.seatId,
            generation: event.generation,
            id: event.id!,
          };
          setTextOwner(event.seatId);
          gateGlobal();
        } else if (globalRequest.current?.id === event.id) {
          globalRequest.current = undefined;
          setTextOwner(undefined);
          coordinator.current?.setInputGate("global-request", false);
        }
        coordinator.current?.setBlocker(
          `text:${event.id}`,
          event.open ? `${event.seatId}: Entering text in Steam` : null,
        );
      }
    });
    registerCoopControls({
      start: (choice) => {
        setSpec(choice);
        setReady([]);
        setStage("confirm");
      },
      ready: () => {},
      back: () => {
        setStage("join");
        store.dispatch(uiDelta({ coop: undefined }));
        store.dispatch(navigate("MAIN_MENU"));
      },
      invite: () =>
        setError("Each player joins with their own controller on this TV."),
      copyCode: () => {},
      openSaves: () => setStage("join"),
    });
    void request({ kind: "setup" })
      .then((value) => {
        if (!live) return;
        const status = value as { available?: boolean; devices?: Device[] };
        setDevices(status.devices ?? []);
        if (!status.available)
          setError(
            "On this TV requires Steam Input. Start Electrify through Steam with installed controller bindings, including in Offline Mode.",
          );
      })
      .catch((failure) => setError(String(failure)));
    void request({ kind: "list-saves" })
      .then((value) => {
        if (live) setLibrary((value as { slots?: Saved[] }).slots ?? []);
      })
      .catch((failure) => setError(String(failure)));
    return () => {
      mounted.current = false;
      startCounter.current++;
      platform.current?.dispose();
      live = false;
      stop();
      registerCoopControls(previous);
      coordinator.current?.dispose();
      void request({ kind: "close" });
    };
    // The shell's lifetime spans setup, play and the save barrier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (stage !== "choose") return;
    store.dispatch(
      uiDelta({
        coop: {
          role: "host",
          hostName: seats[0].name,
          players: seats.map((seat, index) => ({
            ...seat,
            host: index === 0,
            ready: false,
            connected: !!bindings[seat.id],
          })),
          ready: false,
          starting: false,
        },
      }),
    );
    store.dispatch(navigate("NEW_GAME"));
  }, [stage, seats, bindings]);

  useEffect(() => {
    if (stage !== "play") return;
    const stopCheckpoint = registerShutdownCheckpoint(async (reason) => {
      coordinator.current?.setBlocker(
        "shutdown",
        "Saving before leaving or sleeping",
        true,
      );
      try {
        await coordinator.current?.save(reason === "quit");
      } finally {
        if (reason === "suspend")
          coordinator.current?.setBlocker("shutdown", null);
      }
    });
    const stopFocus = desktop.onGameFocusChanged((focused) => {
      coordinator.current?.setInputGate("foreground", !focused);
      coordinator.current?.setBlocker(
        "foreground",
        focused ? null : "Game in background or Steam overlay open",
        !focused,
      );
    });
    const stopPower = desktop.onPowerStateChanged?.((power) => {
      coordinator.current?.setInputGate("power", power.phase !== "awake");
      coordinator.current?.setBlocker(
        "power",
        power.phase === "awake" ? null : "System sleeping or resuming",
        power.phase !== "awake",
      );
    });
    return () => {
      stopCheckpoint();
      stopFocus();
      stopPower?.();
    };
  }, [desktop, stage]);

  const start = async () => {
    if ((!spec && !saved) || busy) return;
    setBusy(true);
    const generation = ++starts.current;
    setError("");
    try {
      const [{ CouchCoordinator }, { createMultiplayerWorker }] =
        await Promise.all([
          import("./Coordinator"),
          import("../multiplayer/WorkerClient"),
        ]);
      if (!mounted.current || generation !== starts.current) return;
      const worker = createMultiplayerWorker();
      const owner = new CouchCoordinator(worker, {
        onAccountView: (view) => platform.current?.publish(view),
        persist: async (world: World) => {
          const result = (await request({ kind: "write-save", world })) as {
            updatedAt: number;
          };
          setSaveTime(result.updatedAt);
        },
        onLeave: (seatId, generation, message) => {
          if (globalRequest.current) {
            owner.resolveLeave(
              seatId,
              generation,
              message.requestId,
              "Another TV session dialog is open",
            );
            return;
          }
          globalRequest.current = {
            kind: "leave",
            seatId,
            generation,
            id: message.requestId,
          };
          gateGlobal();
          leaveRequest.current = {
            seatId,
            generation,
            requestId: message.requestId,
          };
          setSaveFailed(false);
          setDiscarding(false);
          setExitOwner(seatId);
        },
        onSettings: (seatId, generation, requestId) => {
          if (globalRequest.current) return;
          globalRequest.current = {
            kind: "settings",
            seatId,
            generation,
            id: requestId,
          };
          gateGlobal();
          setSettingsOwner(seatId);
          store.dispatch(navigate("SETTINGS"));
        },
        onError: (message: string) => {
          setError(message);
          if (coordinator.current?.getSnapshot().phase === "faulted")
            setSessionFault(true);
        },
        onSeatLost: (seatId) => {
          if (
            !current.current.summary?.players.find(
              (player) => player.id === seatId,
            )?.retired
          )
            setRecovery((value) =>
              value.includes(seatId) ? value : [...value, seatId],
            );
        },
        onSummary: (value) => {
          setSummary(value);
          value.players
            .filter((player) => player.retired)
            .forEach((player) => {
              coordinator.current?.setBlocker(`controller:${player.id}`, null);
              setRecovery((ids) => ids.filter((id) => id !== player.id));
            });
        },
      });
      coordinator.current = owner;
      owner.subscribe(() => setBlockers(owner.getSnapshot().blockers));
      if (saved) owner.restore(saved, crypto.randomUUID());
      else owner.start(spec!, seats, crypto.randomUUID(), crypto.randomUUID());
      setStage("play");
      await request({
        kind: "open",
        seats,
        inset: 24,
        gutter: 8,
        bandHeight: 96,
      });
      if (!mounted.current || generation !== starts.current) return;
    } catch (failure) {
      if (!mounted.current || generation !== starts.current) return;
      setError(String(failure));
      coordinator.current?.dispose();
      coordinator.current = undefined;
      await request({ kind: "close" });
      await request({ kind: "setup" });
      setBindings({});
      setReady([]);
      setStage("join");
    } finally {
      if (mounted.current && generation === starts.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (stage !== "play" || !band.current) return;
    const resize = new ResizeObserver(() => {
      void request({
        kind: "layout",
        options: {
          bandHeight: Math.ceil(band.current!.getBoundingClientRect().height),
        },
      }).catch((failure) => setError(String(failure)));
    });
    resize.observe(band.current);
    return () => resize.disconnect();
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void request({ kind: "setup-confirm", value: stage === "confirm" });
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (
      stage === "confirm" &&
      !busy &&
      seats.every((seat) => saved?.outcomes[seat.id] || ready.includes(seat.id))
    )
      void start();
  }, [stage, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let previous = store.getState().settings;
    return store.subscribe(() => {
      const state = store.getState();
      if (settingsOwner && state.card.name !== "SETTINGS")
        cancelGlobal("Settings closed");
      if (previous === state.settings) return;
      previous = state.settings;
      routes.current.forEach((generation, seatId) => {
        void request({
          kind: "send",
          seatId,
          generation,
          message: { kind: "presentation", generation, settings: previous },
        });
      });
    });
  }, [settingsOwner]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const active = globalRequest.current;
    if (
      !busy &&
      active &&
      active.kind !== "text" &&
      !devices.some(
        (device) => device.id === bindings[active.seatId] && device.connected,
      )
    )
      cancelGlobal("The requesting controller disconnected");
  }, [busy, devices, bindings]); // eslint-disable-line react-hooks/exhaustive-deps

  const missing =
    stage === "play"
      ? seats.filter(
          (seat) =>
            !summary?.players.find((player) => player.id === seat.id)
              ?.retired &&
            !devices.some(
              (device) => device.id === bindings[seat.id] && device.connected,
            ),
        )
      : [];
  const globalOwner =
    textOwner ||
    settingsOwner ||
    exitOwner ||
    (summary?.complete
      ? (seats.find((seat) =>
          devices.some(
            (device) => device.id === bindings[seat.id] && device.connected,
          ),
        )?.id ?? "local-p1")
      : undefined) ||
    (recovery.length || invalidLayout || missing.length || sessionFault
      ? (seats.find((seat) =>
          devices.some(
            (device) => device.id === bindings[seat.id] && device.connected,
          ),
        )?.id ?? "local-p1")
      : undefined);
  useEffect(() => {
    if (stage !== "play") return;
    coordinator.current?.setBlocker(
      "global-dialog",
      globalOwner ? "TV session dialog open" : null,
    );
    coordinator.current?.setInputGate("global-dialog", !!globalOwner);
    void request({ kind: "overlay", seatId: globalOwner ?? null });
  }, [globalOwner, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {stage === "play" && (
        <div ref={band} className="couchBand" data-couch-shell="true">
          <div>
            <strong>On this TV · Unranked</strong>
            <p role="status">
              {summary?.date
                ? `${summary.date.year} / ${summary.date.monthNumber} · ${formatHour(summary.date)} · `
                : ""}
              {summary?.speed ?? "PAUSED"} · {summary?.reason}
            </p>
            <p>
              {summary?.players
                .map(
                  (player, index) =>
                    `P${index + 1} ${player.name}: ${player.retired ? "Retired" : player.selectedSpeed}`,
                )
                .join(" · ")}
            </p>
            <p>
              Last local save:{" "}
              {saveTime ? new Date(saveTime).toLocaleTimeString() : "Saving…"}
            </p>
          </div>
          <Button onClick={() => requestExit("local-p1")}>
            Save & Quit for everyone
          </Button>
          {error && <p role="alert">{error}</p>}
          {!!blockers.length && <p role="status">{blockers.join(" · ")}</p>}
        </div>
      )}
      <Dialog
        open={stage === "join" || stage === "confirm"}
        fullWidth
        maxWidth="sm"
        aria-labelledby="couch-title"
      >
        <DialogTitle id="couch-title">On this TV · Two players</DialogTitle>
        <DialogContent>
          <Typography>
            One controller per company. Each player presses Confirm to join. P1
            chooses the game; both confirm before starting. The slowest speed
            wins and either player can pause.
          </Typography>
          {error && (
            <Typography role="alert" color="error">
              {error}
            </Typography>
          )}
          <div className="couchRoster">
            {seats.map((seat, index) => (
              <div key={seat.id}>
                <TextField
                  label={`P${index + 1} company`}
                  value={seat.name}
                  slotProps={{ htmlInput: { maxLength: 80 } }}
                  disabled={stage !== "join"}
                  onChange={(event) =>
                    setSeats((value) =>
                      value.map((item) =>
                        item.id === seat.id
                          ? { ...item, name: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <Typography>
                  {devices.some(
                    (device) =>
                      device.id === bindings[seat.id] && device.connected,
                  )
                    ? `Controller joined${ready.includes(seat.id) ? " · Ready" : ""}`
                    : "Press Confirm on your controller"}
                </Typography>
                {devices.find((device) => device.id === bindings[seat.id])
                  ?.glyphs.confirm && (
                  <Typography>
                    Confirm:{" "}
                    {
                      devices.find((device) => device.id === bindings[seat.id])
                        ?.glyphs.confirm?.label
                    }
                  </Typography>
                )}
              </div>
            ))}
          </div>
          {stage === "confirm" && (
            <Typography>
              {saved
                ? "Resume the saved companies"
                : getScenario(spec?.scenarioId ?? -1, spec?.customScenario)
                    ?.name}{" "}
              · {spec?.difficulty ?? saved?.spec.difficulty}. Each player:
              release then press Confirm when ready.
            </Typography>
          )}
          {stage === "join" &&
            library.map((slot) => (
              <div key={slot.id}>
                <Button
                  onClick={() => {
                    setBusy(true);
                    void request({ kind: "read-save", id: slot.id })
                      .then(async (value) => {
                        const world = value as World;
                        await request({ kind: "reset-bindings" });
                        setSaved(world);
                        setSaveTime(slot.updatedAt);
                        setSeats(world.seats);
                        setBindings({});
                        setReady([]);
                        setError(
                          "Assign a controller to each saved company before resuming.",
                        );
                      })
                      .catch((failure) => setError(String(failure)))
                      .finally(() => setBusy(false));
                  }}
                >
                  Resume {slot.name} ·{" "}
                  {new Date(slot.updatedAt).toLocaleString()}
                </Button>
                <Button
                  aria-label={`Delete ${slot.name}`}
                  onClick={() => setDeleting(slot)}
                >
                  Delete
                </Button>
              </div>
            ))}
          {!devices.length && (
            <Typography>
              Connect two controllers with Steam Input bindings.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => void close()}>
            Back
          </Button>
          {stage === "join" ? (
            <Button
              variant="contained"
              disabled={
                busy ||
                seats.some(
                  (seat) =>
                    !seat.name.trim() ||
                    (!saved?.outcomes[seat.id] &&
                      !devices.some(
                        (device) =>
                          device.id === bindings[seat.id] && device.connected,
                      )),
                )
              }
              onClick={() => {
                setReady([]);
                setStage(saved ? "confirm" : "choose");
              }}
            >
              {" "}
              {saved ? "Review saved game" : "Choose a game"}{" "}
            </Button>
          ) : (
            <Button
              variant="contained"
              disabled={
                busy ||
                seats.some(
                  (seat) =>
                    !saved?.outcomes[seat.id] && !ready.includes(seat.id),
                )
              }
              onClick={() => void start()}
            >
              Start for everyone
            </Button>
          )}
        </DialogActions>
      </Dialog>
      <Dialog open={!!textOwner} fullWidth maxWidth="sm">
        <DialogTitle>
          {seats.find((seat) => seat.id === textOwner)?.name}: entering text
        </DialogTitle>
        <DialogContent>
          Finish or cancel the Steam text dialog to return to all companies.
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!settingsOwner}
        fullWidth
        maxWidth="md"
        aria-label="TV session settings"
      >
        <DialogTitle>
          {seats.find((seat) => seat.id === settingsOwner)?.name}: TV session
          settings
        </DialogTitle>
        <DialogContent>
          <SettingsContainer />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => cancelGlobal("Settings closed")}>
            Return to all companies
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!summary?.complete && !exitOwner} fullWidth maxWidth="sm">
        <DialogTitle>Match complete</DialogTitle>
        <DialogContent>
          {!seats.some((seat) =>
            devices.some(
              (device) => device.id === bindings[seat.id] && device.connected,
            ),
          ) && (
            <Typography>
              Press Confirm on a controller to operate these results as{" "}
              {seats[0].name}. Company results keep their original identities.
            </Typography>
          )}
          {summary?.players.map((player, index) => (
            <Typography key={player.id}>
              P{index + 1} · {player.name}:{" "}
              {summary.outcomes[player.id]?.title ?? "Company retired"}
            </Typography>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => requestExit(globalOwner ?? "local-p1")}>
            Save & return to setup
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!exitOwner} fullWidth maxWidth="sm">
        <DialogTitle>
          {discarding
            ? "Exit without the newest progress?"
            : "Save & Quit for everyone?"}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {seats.find((seat) => seat.id === exitOwner)?.name} wants to end
            this TV session. Save all companies together on this device.
            Accepted decisions are saved; unsent decisions are cancelled.
          </Typography>
          {error && <Typography role="alert">{error}</Typography>}
          {discarding && (
            <Typography>
              The last successful local save is{" "}
              {saveTime ? new Date(saveTime).toLocaleString() : "unavailable"}.
              Changes since that save will be lost for every company.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            disabled={busy}
            onClick={() => {
              if (leaveRequest.current) {
                const { seatId, generation, requestId } = leaveRequest.current;
                coordinator.current?.resolveLeave(
                  seatId,
                  generation,
                  requestId,
                  "Save & Quit cancelled",
                );
              }
              cancelGlobal("Save & Quit cancelled");
            }}
          >
            Keep playing
          </Button>
          {saveFailed && (
            <Button
              color="error"
              disabled={busy}
              onClick={() => {
                if (discarding) void close();
                else setDiscarding(true);
              }}
            >
              {discarding
                ? "Confirm exit without newest progress"
                : "Exit without newest progress"}
            </Button>
          )}
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setSaveFailed(false);
              void coordinator.current
                ?.save(true)
                .then(summary?.complete ? returnToSetup : close)
                .catch((failure) => {
                  setError(String(failure));
                  setSaveFailed(true);
                })
                .finally(() => setBusy(false));
            }}
          >
            Save & Quit
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!deleting} fullWidth maxWidth="sm">
        <DialogTitle>Delete {deleting?.name}?</DialogTitle>
        <DialogContent>
          This removes the complete local campaign for all its companies from
          this device.
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setDeleting(undefined)}>
            Keep save
          </Button>
          <Button
            disabled={busy}
            color="error"
            onClick={() => {
              if (!deleting) return;
              const id = deleting.id;
              setBusy(true);
              void request({ kind: "delete-save", id })
                .then(() => {
                  setLibrary((slots) => slots.filter((slot) => slot.id !== id));
                  setDeleting(undefined);
                })
                .catch((failure) => setError(String(failure)))
                .finally(() => setBusy(false));
            }}
          >
            Delete local campaign
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={
          stage === "play" &&
          !exitOwner &&
          !settingsOwner &&
          !textOwner &&
          !!(recovery.length || missing.length || invalidLayout || sessionFault)
        }
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>TV session paused</DialogTitle>
        <DialogContent>
          {sessionFault && (
            <Typography role="alert">
              {error} Resume a complete saved checkpoint; progress after the
              last local save may be lost.
            </Typography>
          )}
          {invalidLayout && (
            <Typography>
              Restore the display area and TV scale to fit readable companies,
              or save and quit.
            </Typography>
          )}
          {missing.map((seat) => (
            <Typography key={seat.id}>
              {seat.name}: controller disconnected. Reconnect its assigned
              controller.
            </Typography>
          ))}
          {!!missing.length && (
            <Typography>
              Press Confirm on an unused controller to claim {missing[0].name}.
              The other companies keep their assignments.
            </Typography>
          )}
          {recovery.map((id) => (
            <Button
              key={id}
              onClick={() => {
                void request({ kind: "reload-seat", seatId: id });
                setRecovery((value) => value.filter((item) => item !== id));
              }}
            >
              Restore {seats.find((seat) => seat.id === id)?.name}
            </Button>
          ))}
          <Typography>
            After recovery, each active player selects a running speed to
            resume.
          </Typography>
        </DialogContent>
        <DialogActions>
          {sessionFault ? (
            <Button onClick={() => void returnToSetup()}>
              Return to local saved games
            </Button>
          ) : (
            <Button onClick={() => requestExit(globalOwner ?? "local-p1")}>
              Save & Quit for everyone
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
