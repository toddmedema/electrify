import { IconButton, IconButtonProps, Tooltip } from "@mui/material";
import { AnchorHTMLAttributes, useEffect, useRef, useState } from "react";
import { useControllerInput } from "../../desktop/InputPresentation";

type Props = Omit<IconButtonProps, "aria-label" | "title"> &
  Pick<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "target" | "rel"> & {
    label: string;
  };

/** A footer action has one name and one label across pointer, keyboard and controller input. */
export default function MenuIconButton({
  label,
  onFocus,
  onBlur,
  onPointerEnter,
  onPointerLeave,
  onPointerMove,
  onPointerDown,
  ...props
}: Props): React.JSX.Element {
  const controller = useControllerInput();
  const [focused, setFocused] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [hoverReady, setHoverReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const hovered = useRef(false);
  const pointerFocus = useRef(false);
  const hoverTimer = useRef<number>();
  const clearHover = () => {
    window.clearTimeout(hoverTimer.current);
    setHoverReady(false);
  };
  const startHover = () => {
    clearHover();
    hoverTimer.current = window.setTimeout(() => setHoverReady(true), 300);
  };
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  return (
    <Tooltip
      title={label}
      placement="top"
      open={
        !dismissed && (hoverReady || (focused && (keyboardFocus || controller)))
      }
      disableFocusListener
      disableHoverListener
      disableTouchListener
      disableInteractive
      onClose={() => {
        clearHover();
        setDismissed(true);
      }}
      slotProps={{
        tooltip: { className: "mainMenuTooltip", style: { margin: 0 } },
        popper: {
          modifiers: [
            { name: "offset", options: { offset: [0, 8] } },
            { name: "preventOverflow", options: { padding: 8 } },
          ],
        },
        transition: { timeout: 0 },
      }}
    >
      <IconButton
        color="primary"
        size="large"
        {...props}
        aria-label={label}
        onFocus={(event) => {
          // Hover selection calls focus() too; its inherited :focus-visible must not
          // turn a passing mouse movement into an immediate keyboard label.
          const visible =
            !pointerFocus.current &&
            event.currentTarget.matches(":focus-visible");
          pointerFocus.current = false;
          setFocused(true);
          setKeyboardFocus(visible);
          setDismissed(false);
          if (visible || controller) clearHover();
          else if (hovered.current) startHover();
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          setKeyboardFocus(false);
          pointerFocus.current = false;
          clearHover();
          onBlur?.(event);
        }}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") {
            hovered.current = true;
            pointerFocus.current = true;
            startHover();
          }
          onPointerEnter?.(event);
        }}
        onPointerLeave={(event) => {
          hovered.current = false;
          pointerFocus.current = false;
          clearHover();
          onPointerLeave?.(event);
        }}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse") pointerFocus.current = true;
          onPointerMove?.(event);
        }}
        onPointerDown={(event) => {
          pointerFocus.current = true;
          if (event.pointerType !== "mouse") {
            hovered.current = false;
            setKeyboardFocus(false);
            clearHover();
          }
          onPointerDown?.(event);
        }}
      />
    </Tooltip>
  );
}
