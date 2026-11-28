import * as React from "react";
import { Button, Typography } from "@mui/material";
import type { GameType } from "../../Types";
import { CouchPlayerText } from "../../couch/PlayerColor";
import { getCostTableIndex } from "../../data/Economy";
import { accessContextForGame } from "../../data/IntertieAccess";
import { formatBuildMonths, formatWatts } from "../../helpers/Format";
import { currentTick } from "../../helpers/GameSelectors";
import { intertieUpgradeQuote } from "../../helpers/Transmission";
import { multiplayerRuntime } from "../../multiplayer/Registry";
import type {
  ConnectionDecision,
  UpgradeDecision,
} from "../../multiplayer/Types";
import { useMoney } from "../base/CurrencyContext";
import PurchaseReviewDialog from "../base/PurchaseReviewDialog";
import {
  TradingControls,
  type TransmissionPanelProps,
} from "./TransmissionPanel";

type Peer = NonNullable<NonNullable<GameType["multiplayer"]>["peers"]>[number];
type AgreementReview =
  | { kind: "connection"; decision: ConnectionDecision }
  | { kind: "upgrade"; decision: UpgradeDecision };

export default function TerritorialAgreements({
  game,
  selectedPeer,
  onBuyingRule,
  onSellingRule,
}: Pick<TransmissionPanelProps, "game" | "onBuyingRule" | "onSellingRule"> & {
  selectedPeer?: string;
}) {
  const { formatPricePerMWh } = useMoney();
  const peers = game.multiplayer?.peers ?? [];
  const first = peers.find(({ id }) => id === selectedPeer);
  const listedPeers = first
    ? [first, ...peers.filter((peer) => peer !== first)]
    : peers;
  const price = game.multiplayer?.pricePerMWh;
  return (
    <div className="territoryAgreements multiplayerAgreements">
      {game.multiplayer?.peers?.some(({ connected }) => connected) && (
        <section aria-label="Co-op trade rules">
          {price !== undefined && (
            <Typography variant="body2">
              Peer market price {formatPricePerMWh(price)}
            </Typography>
          )}
          <TradingControls
            game={game}
            onBuyingRule={onBuyingRule}
            onSellingRule={onSellingRule}
          />
        </section>
      )}
      {listedPeers.map((peer) => (
        <PeerAgreement key={peer.id} game={game} peer={peer} />
      ))}
    </div>
  );
}

function PeerAgreement({ game, peer }: { game: GameType; peer: Peer }) {
  const [review, setReview] = React.useState<AgreementReview>();
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string>();
  const title = React.useId();
  const corridor = peer.corridor;
  const line = game.transmission?.lines.find(
    (line) => line.corridorId === corridor.id,
  );
  const cash = currentTick(game)?.cash ?? 0;
  const ceased = peer.retired || !!game.multiplayer?.ending;
  const connecting = !!line && !peer.connected;
  const upgrade =
    line && peer.connected && !line.upgrade
      ? intertieUpgradeQuote(
          line,
          game.date.year,
          1,
          1,
          accessContextForGame(game),
        )
      : undefined;
  const request = line ? peer.upgradeRequestedBy : peer.connectionRequestedBy;
  const requestedHere = line
    ? peer.upgradeRequestedBySelf
    : peer.connectionRequestedBySelf;
  const canReview =
    !ceased && !connecting && (line ? !!upgrade : !!peer.border);
  const action = line ? "upgrade" : "connection";
  const proposalRevision = line
    ? peer.upgradeProposalRevision
    : peer.connectionProposalRevision;
  const activeReview =
    review?.kind === action && canReview && !requestedHere ? review : undefined;
  const reviewLabel = `${activeReview?.decision.intent === "accept" ? "Accept" : "Propose"} ${action}`;
  const status = ceased
    ? "retired"
    : line
      ? connecting
        ? "construction"
        : "connected"
      : request
        ? "proposed"
        : peer.border
          ? "border"
          : "no-border";
  const rating = peer.ratingW ?? 0;
  const flow = line?.currentFlowW ?? 0;
  const costIndex = getCostTableIndex(game.date, game.startingYear, game.seed);

  function openReview() {
    const acceptance =
      proposalRevision === undefined
        ? undefined
        : ({ intent: "accept", proposalRevision } as const);
    if (line)
      setReview({
        kind: "upgrade",
        decision: acceptance ?? { intent: "propose" },
      });
    else if (peer.border)
      setReview({
        kind: "connection",
        decision: acceptance ?? { intent: "propose", border: peer.border },
      });
  }

  async function submit(
    financed: boolean,
    kind: AgreementReview["kind"],
    decision: AgreementReview["decision"],
  ): Promise<string | undefined> {
    const runtime = multiplayerRuntime();
    if (!runtime) return "The shared game is unavailable.";
    try {
      await runtime.submit({
        kind: "action",
        name:
          kind === "connection"
            ? "buildTransmissionLine"
            : "upgradeTransmissionLine",
        payload: { corridorId: corridor.id, financed, ...decision },
      });
    } catch (error) {
      return error instanceof Error
        ? error.message
        : "The request was not accepted.";
    }
  }
  async function withdraw() {
    if (busy || proposalRevision === undefined) return;
    setBusy(true);
    setNotice(
      await submit(false, action, { intent: "withdraw", proposalRevision }),
    );
    setBusy(false);
  }
  function statusLabel() {
    if (peer.retired) return "Company retired";
    if (game.multiplayer?.ending) return "Your company retired";
    if (connecting)
      return `Construction underway · ${formatBuildMonths(line.yearsToBuildLeft)} left`;
    if (request)
      return requestedHere
        ? `${peer.name} must approve`
        : `${peer.name} proposed a ${action}`;
    if (line?.upgrade)
      return `Connected · upgrading, ${formatBuildMonths(line.upgrade.yearsToBuildLeft)} left`;
    if (peer.connected) return "Connected";
    if (peer.border) return "Shared border";
    return "Expand to a shared border to connect.";
  }

  return (
    <section
      className="multiplayerPeerAgreement"
      aria-labelledby={title}
      data-peer-id={peer.id}
      data-connection-status={status}
    >
      <Typography component="h3" variant="subtitle1" id={title}>
        <CouchPlayerText seatId={peer.id}>{peer.name}</CouchPlayerText>
      </Typography>
      <Typography variant="body2" color="textSecondary" role="status">
        {statusLabel()}
      </Typography>
      {!ceased && peer.connected && (
        <Typography variant="body2">
          {flow > 0
            ? `Importing ${formatWatts(flow)}`
            : flow < 0
              ? `Exporting ${formatWatts(-flow)}`
              : "No power flowing"}
          {" · "}
          {formatWatts(rating)} available
        </Typography>
      )}
      {canReview && requestedHere && (
        <Button disabled={busy} onClick={withdraw}>
          Withdraw proposal
        </Button>
      )}
      {canReview && !requestedHere && (
        <Button
          variant="outlined"
          aria-label={
            request
              ? `Review ${action} from ${peer.name}`
              : `Review ${action} with ${peer.name}`
          }
          onClick={openReview}
        >
          {request ? `Review proposed ${action}` : `Review ${action}`}
        </Button>
      )}
      {notice && (
        <Typography role="alert" variant="body2" color="error">
          {notice}
        </Typography>
      )}
      {activeReview && (
        <PurchaseReviewDialog
          open
          title={`${reviewLabel} ${line ? "with" : "to"} ${peer.name}?`}
          cash={cash}
          buildCost={upgrade?.buildCost ?? corridor.buildCost}
          interestRate={game.interestRate}
          refinancedBalance={line?.loanAmountLeft}
          upkeepPerMonth={
            ((upgrade?.annualOperatingCost ?? corridor.annualOperatingCost) *
              costIndex) /
            12
          }
          onlineInMonths={Math.round(
            (upgrade?.yearsToBuild ?? corridor.yearsToBuild) * 12,
          )}
          cashButtonLabel={reviewLabel}
          extraFacts={[
            {
              concept: "supply",
              label: "Design capacity",
              value: formatWatts(
                upgrade?.targetCapacityW ?? corridor.capacityW,
              ),
            },
          ]}
          preface={
            <Typography variant="body2" sx={{ px: 2, pb: 1 }}>
              Each company pays for its half when both companies approve.
            </Typography>
          }
          onClose={() => setReview(undefined)}
          onPurchase={async (financed) => {
            const error = await submit(
              financed,
              activeReview.kind,
              activeReview.decision,
            );
            if (error) return error;
            setReview(undefined);
          }}
        />
      )}
    </section>
  );
}
