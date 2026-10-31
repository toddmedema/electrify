import * as React from "react";
import type { ManualEntryTitleType } from "./ManualEntries";

/**
 * Opens another manual entry. Whatever is showing the entry decides what that means: the full
 * manual records it as a step Back can retrace, and the help popover swaps its content in place.
 */
export const ManualEntryNavigation = React.createContext<
  ((title: ManualEntryTitleType) => void) | undefined
>(undefined);

export function manualEntryId(title: string): string {
  return `manual-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

interface Props {
  to: ManualEntryTitleType;
  children: React.ReactNode;
}

/**
 * A term in an entry's prose that names another entry, linked the way a wiki links its articles.
 * Outside a manual surface there is nowhere to go, so it reads as plain text.
 */
export default function ManualEntryLink({
  to,
  children,
}: Props): React.JSX.Element {
  const open = React.useContext(ManualEntryNavigation);
  if (!open) {
    return <>{children}</>;
  }
  return (
    <a
      className="manual-entry-link"
      href={`#${manualEntryId(to)}`}
      onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        // Entries sit inside rows and popovers that react to clicks of their own
        event.stopPropagation();
        open(to);
      }}
    >
      {children}
    </a>
  );
}
