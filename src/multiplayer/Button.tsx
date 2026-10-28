import { Button } from "@mui/material";
import { showMultiplayerLobby } from "./Registry";
export default function MultiplayerButton() {
  return (
    <Button
      data-main-action
      size="large"
      color="primary"
      onClick={showMultiplayerLobby}
    >
      Play with friends
    </Button>
  );
}
