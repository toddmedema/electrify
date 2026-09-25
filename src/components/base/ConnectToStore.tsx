import * as React from "react";
import { shallowEqual, useDispatch, useSelector } from "react-redux";
import type { AppDispatch } from "../../Store";
import type { AppStateType } from "../../Types";

/**
 * `connect(mapStateToProps, mapDispatchToProps)` built from the store hooks.
 *
 * react-redux's `connect` gives every connected component its own subscription and makes the
 * connected components and `useSelector` hooks below it subscribe to that, not the store. It
 * notifies them from a layout effect after its own update commits, so each connected ancestor
 * whose props change on a tick costs every store reader beneath it one more React commit. The
 * game panes all map `state.game`, so a tick committed once per level: twice on desktop and
 * three times on a phone, where the pane's card also carries the app bar. Hooks subscribe to
 * the store directly, so one dispatch updates every reader in one commit.
 *
 * Behaves like `connect` otherwise: the component re-renders only when its own props or a
 * shallowly compared field of `mapStateToProps` changes, `mapStateToProps` receives the own
 * props, and `mapDispatchToProps` runs once. One difference: without `mapDispatchToProps`,
 * `connect` injects a `dispatch` prop and this does not; map what the component needs instead.
 */
export function connectToStore<
  StateProps extends object,
  DispatchProps extends object = object,
  OwnProps extends object = object,
>(
  mapStateToProps: (state: AppStateType, ownProps: OwnProps) => StateProps,
  mapDispatchToProps?: (dispatch: AppDispatch) => DispatchProps,
) {
  return <Props extends StateProps & DispatchProps & OwnProps>(
    Component: React.ComponentType<Props>,
  ) => {
    // Like connect, the wrapper takes whatever the mapped props leave unset
    type WrapperProps = Omit<Props, keyof StateProps | keyof DispatchProps> &
      OwnProps;
    function Connected(ownProps: WrapperProps) {
      const stateProps = useSelector(
        (state: AppStateType) => mapStateToProps(state, ownProps),
        shallowEqual,
      );
      const dispatch = useDispatch<AppDispatch>();
      const dispatchProps = React.useMemo(
        () => mapDispatchToProps?.(dispatch),
        [dispatch],
      );
      const props = {
        ...ownProps,
        ...stateProps,
        ...dispatchProps,
      } as unknown as Props;
      return <Component {...props} />;
    }
    Connected.displayName = `Connected(${Component.displayName || Component.name})`;
    return React.memo(Connected);
  };
}
