// Playwright serializes this function into an isolated page. It receives short-lived credentials
// and synthetic traffic only. Nothing here is part of the production signaling or game client.
function installTurnProbe({ iceServer, channelId, receiptDelayMs }) {
  const peer = new RTCPeerConnection({
    iceServers: [iceServer],
    iceTransportPolicy: "relay",
  });
  const channel = peer.createDataChannel("electrify-turn-probe", {
    id: channelId,
    negotiated: true,
    ordered: true,
  });
  const receipts = [];
  let expected = 1;
  let invalid = false;
  channel.onmessage = ({ data }) => {
    if (typeof data !== "string") {
      invalid = true;
      return;
    }
    if (receiptDelayMs !== null) {
      const separator = data.indexOf(":");
      if (
        separator < 1 ||
        data.slice(0, separator) !== String(expected) ||
        !/^x{8192}$/.test(data.slice(separator + 1))
      ) {
        invalid = true;
        return;
      }
      const sequence = expected++;
      setTimeout(() => {
        if (channel.readyState === "open") channel.send(String(sequence));
      }, receiptDelayMs);
    } else {
      const sequence = Number(data);
      if (sequence !== receipts.length + 1) invalid = true;
      else receipts.push(sequence);
    }
  };

  window.turnProbes ??= {};
  window.turnProbes[channelId] = {
    peer,
    channel,
    receipts,
    received: () => expected - 1,
    healthy: () => !invalid,
    async selectedPair() {
      const stats = await peer.getStats();
      const transports = [...stats.values()].filter(
        (entry) => entry.type === "transport" && entry.selectedCandidatePairId,
      );
      if (transports.length !== 1) return null;
      const pair = stats.get(transports[0].selectedCandidatePairId);
      if (pair?.type !== "candidate-pair" || pair.state !== "succeeded")
        return null;
      const local = stats.get(pair.localCandidateId);
      const remote = stats.get(pair.remoteCandidateId);
      return {
        relayToRelay:
          local?.type === "local-candidate" &&
          local.candidateType === "relay" &&
          remote?.type === "remote-candidate" &&
          remote.candidateType === "relay",
        relayProtocol: local?.relayProtocol ?? null,
        localEndpoint: `${local?.address}:${local?.port}`,
        remoteEndpoint: `${remote?.address}:${remote?.port}`,
        bytesReceived: Number.isFinite(pair.bytesReceived)
          ? pair.bytesReceived
          : null,
      };
    },
  };
}

async function gatherDescription({ id, type }) {
  const { peer } = window.turnProbes[id];
  await peer.setLocalDescription(
    type === "offer" ? await peer.createOffer() : await peer.createAnswer(),
  );
  // A single configured TURN URL is sufficient for this probe. WebKit can expose a
  // usable relay while other interfaces are still trying to gather candidates.
  const deadline = performance.now() + 12000;
  for (;;) {
    const description = peer.localDescription;
    if (
      !description ||
      /^a=candidate:.* typ relay(?: |\r?$)/m.test(description.sdp) ||
      peer.iceGatheringState === "complete" ||
      performance.now() >= deadline
    )
      return description && { type: description.type, sdp: description.sdp };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

module.exports = { installTurnProbe, gatherDescription };
