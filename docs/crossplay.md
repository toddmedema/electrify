# Web and Steam cross-play

Open **Play with friends** from the title screen. On Steam, choose **Web & Steam**
when a friend is on the website or uses the standalone desktop edition. Host a game
and send the six-digit invite code to your friends. They enter it on the same screen.
Steam players also have **Steam friends** for Steam-only lobbies and **Local Co-op**
on the same screen. Steam-only and cross-play invite codes belong to their own lobbies.

The host runs the same unranked multiplayer simulation as a Steam friends lobby.
Players need matching game builds. Cross-play campaigns are stored on the host's
device and appear under **Load multiplayer save** when the host opens a new lobby
in **Web & Steam**. The Steam friends campaign library remains separate. A relay
restart or an extended host disconnect ends the live room. The host can use a
checkpoint to reopen the campaign and invite players with a new code.

## Development

Use Node 26. In separate terminals run:

```sh
npm ci --prefix relay
npm --prefix relay start
REACT_APP_COOP_RELAY_URL=ws://127.0.0.1:8787/v1 npm start
```

The relay defaults to the loopback interface and allows `http://localhost:3000`
for local development. Include the actual frontend origin in `COOP_RELAY_ORIGINS`
if you use a different URL. To exercise the same room in a desktop package, provide
the same `REACT_APP_COOP_RELAY_URL` to `npm run desktop:build` or `npm run desktop:pack`.
The browser and desktop packages should be built from the same commit.

```sh
npm --prefix relay test
npm run test:crossplay
```

The browser tests launch an isolated relay on a random loopback port and run the
existing host and replica workers in Chromium. The Steam renderer fixture supplies
desktop identity and capabilities. Cross-play traffic goes through the real relay.

## Deployment

Build the relay container with `docker build -t electrify-relay relay` and run it
behind a TLS ingress that supports WebSocket upgrades to `/v1`. HTTP health checks
use `/healthz`. Set `COOP_RELAY_ORIGINS` to a comma-separated list of allowed origins,
including the production website and `electrify://app` for desktop. Configure ingress
timeouts for long-running connections. The process keeps rooms in memory, so run a
single relay instance until room routing and shared state are available. Deployments
of the relay disconnect live games. The relay stores neither names nor game saves
after a room ends.

Set the GitHub repository variable `COOP_RELAY_URL` to the public `wss://…/v1`
endpoint for the website deploy workflow. Pass it as `REACT_APP_COOP_RELAY_URL` to
the Steam packaging build as well. The desktop shell allows only that configured
WebSocket destination. Leaving the build variable empty keeps the website's
multiplayer entry hidden and the existing Steam modes available.

The ingress should rate-limit upgrade connections. Set `COOP_RELAY_TRUST_PROXY=1`
only if the relay is reachable solely through a proxy that supplies a trusted
client IP in the last `X-Forwarded-For` position. Without that setting, the relay
uses the socket's remote address for its lobby-attempt limit.
