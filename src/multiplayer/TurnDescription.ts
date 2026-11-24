const candidate =
  /^a=candidate:([a-zA-Z0-9+/]{1,32}) 1 udp (\d{1,10}) ([0-9a-f:.]+) (\d{1,5}) typ relay(?: |$)/i;

function publicRelay(address: string) {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)) {
    const parts = address.split(".").map(Number);
    if (parts.some((part) => part > 255)) return false;
    const [a, b] = parts;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (parts[2] === 0 || parts[2] === 2)) ||
      (a === 192 && b === 88 && parts[2] === 99) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && parts[2] === 100) ||
      (a === 203 && b === 0 && parts[2] === 113)
    )
      return false;
    return true;
  }
  if (!address.includes(":") || address.includes("%")) return false;
  return publicV6(address);
}

/** Eight hextets, with a dotted IPv4 tail rewritten so mapped addresses compare evenly. */
function ipv6Words(address: string): number[] | undefined {
  let value = address.toLowerCase();
  const dotted = value.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const parts = dotted[2].split(".").map(Number);
    if (parts.some((part) => part > 255)) return undefined;
    const hi = ((parts[0] << 8) | parts[1]).toString(16);
    const lo = ((parts[2] << 8) | parts[3]).toString(16);
    value = `${dotted[1]}${hi}:${lo}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return undefined;
  const read = (text: string) => (text ? text.split(":") : []);
  const left = read(halves[0]);
  const right = halves.length === 2 ? read(halves[1]) : [];
  if ([...left, ...right].some((word) => !/^[0-9a-f]{1,4}$/.test(word)))
    return undefined;
  if (halves.length === 1) {
    if (left.length !== 8) return undefined;
    return left.map((word) => Number.parseInt(word, 16));
  }
  if (left.length + right.length > 7) return undefined;
  return [
    ...left,
    ...Array(8 - left.length - right.length).fill("0"),
    ...right,
  ].map((word) => Number.parseInt(word, 16));
}

function publicV6(address: string) {
  const words = ipv6Words(address);
  if (!words) return false;
  const [first, second] = words;
  if (
    words.every((word) => word === 0) ||
    (words[7] === 1 && words.slice(0, 7).every((word) => word === 0)) ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0x2001 && second === 0x0db8) ||
    (words[5] === 0xffff && words.slice(0, 5).every((word) => word === 0))
  )
    return false;
  return true;
}

function canonicalLine(line: string) {
  if (/^a=candidate:/i.test(line) || line.startsWith("m=application "))
    return true;
  if (/^a=group:BUNDLE /i.test(line)) return true;
  return [
    "v=",
    "o=",
    "s=",
    "t=",
    "c=",
    "a=mid:",
    "a=fingerprint:",
    "a=ice-ufrag:",
    "a=ice-pwd:",
    "a=setup:",
    "a=sctp-port:",
    "a=max-message-size:",
    "a=end-of-candidates",
  ].some((prefix) => line === prefix || line.startsWith(prefix));
}
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
  const cleanCandidates = new Map<number, string>();
  for (const [index, line] of lines.entries()) {
    const fields = candidate.exec(line);
    if (!fields) continue;
    const [, foundation, priority, address, port] = fields;
    if (!publicRelay(address)) continue;
    const endpoint = `${address}:${Number(port)}`;
    if (endpoints.has(endpoint)) continue;
    endpoints.add(endpoint);
    cleanCandidates.set(
      index,
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
  const safe = lines.flatMap((line, index) => {
    if (/^a=candidate:/i.test(line)) return cleanCandidates.get(index) ?? [];
    if (!canonicalLine(line)) return [];
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
