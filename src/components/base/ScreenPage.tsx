import * as React from "react";
import ScreenHeader from "./ScreenHeader";

type Props = React.ComponentProps<typeof ScreenHeader> &
  Omit<React.HTMLAttributes<HTMLDivElement>, "title">;

/** Shared header and body insets within the compositor's single menu width container. */
export default React.forwardRef<HTMLDivElement, Props>(function ScreenPage(
  {
    title,
    onBack,
    titleComponent,
    trailing,
    className = "",
    children,
    ...pageProps
  }: Props,
  ref,
): React.JSX.Element {
  return (
    <div
      {...pageProps}
      ref={ref}
      className={("screenPage flexContainer " + className).trim()}
    >
      <ScreenHeader
        title={title}
        onBack={onBack}
        titleComponent={titleComponent}
        trailing={trailing}
      />
      {children}
    </div>
  );
});
