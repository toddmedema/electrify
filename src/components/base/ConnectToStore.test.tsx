import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import { configureStore, createSlice, PayloadAction } from "@reduxjs/toolkit";
import { connect, Provider } from "react-redux";
import { AppStateType } from "../../Types";
import { connectToStore } from "./ConnectToStore";

const slice = createSlice({
  name: "test",
  initialState: { tick: 0, label: "a" },
  reducers: {
    tick: (state) => {
      state.tick++;
    },
    label: (state, action: PayloadAction<string>) => {
      state.label = action.payload;
    },
  },
});

function testStore() {
  return configureStore({ reducer: { test: slice.reducer } });
}
type TestState = ReturnType<ReturnType<typeof testStore>["getState"]>;
const tickOf = (state: AppStateType) =>
  (state as unknown as TestState).test.tick;

let renders: Record<string, number> = {};
function counted(name: string) {
  renders[name] = (renders[name] || 0) + 1;
}

function Leaf({ tick }: { tick: number }) {
  counted("leaf");
  return <span data-testid="leaf">{tick}</span>;
}

function Pane({
  tick,
  title,
  children,
}: {
  tick: number;
  title: string;
  children?: React.ReactNode;
}) {
  counted("pane");
  return (
    <div>
      <span data-testid="pane">
        {title} {tick}
      </span>
      {children}
    </div>
  );
}

function renderTree(
  wrap: typeof connectToStore,
  store = testStore(),
): { store: ReturnType<typeof testStore>; commits: () => number } {
  const ConnectedLeaf = wrap((state) => ({ tick: tickOf(state) }))(Leaf);
  const ConnectedPane = wrap((state) => ({ tick: tickOf(state) }))(Pane);
  let commits = 0;
  render(
    <Provider store={store}>
      <React.Profiler id="test" onRender={() => commits++}>
        <ConnectedPane title="Pane">
          <ConnectedLeaf />
        </ConnectedPane>
      </React.Profiler>
    </Provider>,
  );
  commits = 0;
  renders = {};
  return { store, commits: () => commits };
}

describe("connectToStore", () => {
  test("updates nested store readers in one commit per dispatch", () => {
    const { store, commits } = renderTree(connectToStore);

    act(() => {
      store.dispatch(slice.actions.tick());
    });

    expect(screen.getByTestId("pane")).toHaveTextContent("Pane 1");
    expect(screen.getByTestId("leaf")).toHaveTextContent("1");
    expect(commits()).toBe(1);
  });

  test("connect commits once more per nested level, which it replaces", () => {
    const { store, commits } = renderTree(
      connect as unknown as typeof connectToStore,
    );

    act(() => {
      store.dispatch(slice.actions.tick());
    });

    expect(screen.getByTestId("leaf")).toHaveTextContent("1");
    expect(commits()).toBe(2);
  });

  test("skips renders when no mapped field changed", () => {
    const { store, commits } = renderTree(connectToStore);

    act(() => {
      store.dispatch(slice.actions.label("b"));
    });

    expect(commits()).toBe(0);
    expect(renders).toEqual({});
  });

  test("passes own props through and maps dispatch once", () => {
    const store = testStore();
    const mapDispatch = jest.fn((dispatch) => ({
      onTick: () => dispatch(slice.actions.tick()),
    }));
    const Button = ({
      tick,
      label,
      onTick,
    }: {
      tick: number;
      label: string;
      onTick: () => void;
    }) => (
      <button onClick={onTick}>
        {label} {tick}
      </button>
    );
    const ConnectedButton = connectToStore(
      (state) => ({ tick: tickOf(state) }),
      mapDispatch,
    )(Button);
    render(
      <Provider store={store}>
        <ConnectedButton label="Ticks" />
      </Provider>,
    );

    act(() => {
      screen.getByRole("button").click();
    });
    act(() => {
      screen.getByRole("button").click();
    });

    expect(screen.getByRole("button")).toHaveTextContent("Ticks 2");
    expect(mapDispatch).toHaveBeenCalledTimes(1);
  });
});
