const candidate =
  /^a=candidate:([a-zA-Z0-9+/]{1,32}) 1 udp (\d{1,10}) (\d{1,3}(?:\.\d{1,3}){3}) (\d{1,5}) typ relay(?: |$)/i;
const limit = 16 * 1024;

/** Related addresses and optional ICE metadata can disclose the browser's network.
 * They are unnecessary for establishing these fully gathered relay-only exchanges. */
export function relayDescription(
  description: RTCSessionDescriptionInit,
): RTCSessionDescriptionInit {
  if (
    !description.sdp ||
    description.sdp.length > limit ||
    !["offer", "answer"].includes(description.type)
  ) {
    throw new Error("Invalid relay description");
  }
  const lines = description.sdp.trimEnd().split(/\r?\n/);
  const endpoints = new Set<string>();
  const cleanCandidates = new Map<string, string>();
  for (const line of lines) {
    const fields = candidate.exec(line);
    if (!fields) continue;
    const [, foundation, priority, address, port] = fields;
    const endpoint = `${address}:${Number(port)}`;
    if (endpoints.has(endpoint)) continue;
    endpoints.add(endpoint);
    cleanCandidates.set(
      line,
      `a=candidate:${foundation} 1 udp ${priority} ${address} ${port} typ relay`,
    );
  }
  if (!endpoints.size || endpoints.size > 16)
    throw new Error("No eligible relay candidates");

  const port = lines
    .find((line) => line.startsWith("m=application "))
    ?.split(" ")[1];
  const address = lines
    .find((line) => line.startsWith("c=IN IP4 "))
    ?.split(" ")[2];
  const preserveDefault = endpoints.has(`${address}:${Number(port)}`);
  const safe = lines.flatMap((line) => {
    if (line.startsWith("a=candidate:")) return cleanCandidates.get(line) ?? [];
    if (
      /^a=(?:ice-options|remote-candidates|ice-pacing|msid-semantic):/.test(
        line,
      ) ||
      ["a=ice-lite", "a=extmap-allow-mixed", "a=sendrecv"].includes(line)
    ) {
      return [];
    }
    if (line.startsWith("o="))
      return line.replace(/ IN IP[46] \S+$/, " IN IP4 0.0.0.0");
    if (line.startsWith("c=") && !preserveDefault) return "c=IN IP4 0.0.0.0";
    if (line.startsWith("m=application ") && !preserveDefault)
      return line.replace(/^m=application \d+ /, "m=application 9 ");
    return line.trimEnd();
  });
  return { type: description.type, sdp: safe.join("\r\n") + "\r\n" };
}

export function relayEndpoints(description?: RTCSessionDescriptionInit) {
  return new Set(
    description?.sdp?.split(/\r?\n/).flatMap((line) => {
      const fields = candidate.exec(line);
      return fields ? [`${fields[3]}:${Number(fields[4])}`] : [];
    }),
  );
}

export async function selectedRelayPair(
  pc: RTCPeerConnection,
  local: RTCSessionDescriptionInit | undefined,
  remote: RTCSessionDescriptionInit | undefined,
): Promise<boolean> {
  const stats = await pc.getStats();
  const transports = Array.from(stats.values()).filter(
    (entry) => entry.type === "transport" && entry.selectedCandidatePairId,
  );
  if (transports.length !== 1) return false;
  const pair = stats.get(transports[0].selectedCandidatePairId);
  if (pair?.type !== "candidate-pair" || pair.state !== "succeeded")
    return false;
  const localCandidate = stats.get(pair.localCandidateId);
  const remoteCandidate = stats.get(pair.remoteCandidateId);
  return (
    localCandidate?.type === "local-candidate" &&
    remoteCandidate?.type === "remote-candidate" &&
    localCandidate.candidateType === "relay" &&
    remoteCandidate.candidateType === "relay" &&
    relayEndpoints(local).has(
      `${localCandidate.address}:${localCandidate.port}`,
    ) &&
    relayEndpoints(remote).has(
      `${remoteCandidate.address}:${remoteCandidate.port}`,
    )
  );
}
