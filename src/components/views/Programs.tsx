import * as React from "react";
import { useAppDispatch, useAppSelector } from "../../Store";
import { delta } from "../../reducers/Game";
import { ProgramsScreen } from "./CustomerPrograms";
import RateControls from "./RateControls";
import "./Programs.scss";

/** One place for the utility's customer-facing decisions, including its electricity rate. */
export default function Programs({
  onClose,
  onBackChange,
}: {
  onClose: () => void;
  onBackChange?: React.Dispatch<React.SetStateAction<(() => void) | undefined>>;
}) {
  const game = useAppSelector((state) => state.game);
  const dispatch = useAppDispatch();
  return (
    <ProgramsScreen
      embedded
      onClose={onClose}
      onBackChange={onBackChange}
      pricing={
        <RateControls
          game={game}
          onDelta={(change) => dispatch(delta(change))}
        />
      }
    />
  );
}
