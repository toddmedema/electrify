# November 17 master CI failure: five whys

## Evidence and scope

The latest failed master commit investigated was `05476e08`, merged from #818.
The preceding master commit, `8cd5fd94`, passed both workflows.
There are two independent software defects and a hosted-runner capacity failure.
They should not be explained as one causal chain.

- [Production deployment, run 44163279417](https://github.com/toddmedema/electrify/actions/runs/44163279417/job/134322500191):
  the web build succeeded. Firebase rules/indexes and the mailing-list function
  were already deployed when AWS rejected `GetDistributionConfig` for
  `electrify-gh-actions` on distribution `E38D57AILAHD00`. No web upload followed.
- [Test Code, run 44163279744](https://github.com/toddmedema/electrify/actions/runs/44163279744/job/134323623196):
  the mobile 390 px, two-player normal-game journey timed out waiting for a held
  reconnect baseline. It passed its diagnostic retry; the gate correctly failed
  on the flaky first attempt. The other 55 multiplayer cases passed; one was
  skipped. Controller journeys and packaged desktop tests passed.
- The macOS ARM64 build never acquired a hosted runner. GitHub reported capacity
  constraints, so that job provides no evidence of a source-code defect.

The unchanged production-renderer mobile journey also passed locally in 31.5
seconds. Its CI first attempt retained an error context and screenshots, but no
trace. A successful retry does not establish the first attempt's event ordering.

## Deployment: five whys

1. **Why did production deployment stop?** AWS denied
   `cloudfront:GetDistributionConfig` to the production deployment identity.
2. **Why did deployment need that previously unused permission?** The release
   script now reads and reconciles CloudFront configuration and functions to
   implement sitemap redirects, caching, and the custom 404 response.
3. **Why was the deployed identity missing the new capability?** The code change
   documented the additional IAM actions, but did not ship a versioned policy
   contract or verify readiness using the production workflow's identity.
4. **Why was this discovered after production had already changed?** AWS
   authentication and hosting checks followed Firebase deployment. Hosting
   prerequisites were embedded inside the later publication operation.
5. **Why could those requirements and sequencing drift?** Release readiness,
   resource targets, and infrastructure capabilities had no shared executable
   owner; operator prose and a successful mocked deployment were treated as
   sufficient release prerequisites.

The root solution separates read-only readiness from mutation while sharing the
same checks and resource contract. The workflow authenticates to AWS and checks
hosting readiness before Firebase changes. Publication repeats the live checks
before uploads, retaining fresh ETags and ownership/conflict protections. A
versioned least-privilege policy makes the required capabilities reviewable and
verifiable alongside the commands that use them.

The technical lead rejected moving every CloudFront mutation into a one-time
provisioning step: sitemap-derived routing must continue to change with authored
pages. Routine publishing retains edge updates and dependency-before-HTML upload
ordering. Read-only probes establish resource/read readiness; they cannot prove
write authorization. An operator must apply the policy to the production
identity and verify its effective permissions before retrying deployment. The two named edge functions are a one-time
operator provisioning prerequisite: AWS does not support resource scoping for
`CreateFunction`, so the routine release identity only updates and publishes the
two existing functions. This PR does not change live IAM or deploy production.

## Multiplayer: five whys

1. **Why did the test gate fail?** The first attempt never observed the held
   reconnect baseline within the existing 20-second assertion window.
2. **What runtime failure can produce a missing reconnect baseline?** A new
   connection can exhaust the existing two-attempt recovery budget if an
   attempted baseline was first sent to its dead predecessor.
3. **Why can a dead predecessor consume an attempt?** An asynchronous native
   send can reject with `Player is disconnected` before the renderer processes
   its native disconnect notification. Renderer membership still describes the
   old connection as current during that interval.
4. **Why does that rejection request a baseline?** Replication's send-error path
   treats every current send failure as a reason to repair the replica. It
   conflates transport loss with recoverable stream failure.
5. **Why did existing verification miss that boundary?** The neighboring
   regression delivers the disconnect notification before flushing failed
   sends. It verifies obsolete-connection cleanup, but omits rejection-first
   ordering while the old membership remains current.

The root solution keeps native connection events authoritative. A known
channel-loss rejection does not initiate replica repair; a subsequent genuine
connection event requests its fresh baseline. Generic send failures retain
recovery, and the durable two-attempt/60-second budget remains unchanged. The
regression forces rejection before notification using the real recovery owner,
then proves that reconnect installs a fresh baseline.

This is a reproducible runtime defect and a plausible mechanism for the hosted
failure. The retained CI evidence cannot establish that this was its exact
schedule. In particular, the synchronizing notice can also originate from a
record gap, and the fixture's baseline counter includes rejected send attempts.
Failure diagnostics must distinguish attempts from successful deliveries rather
than treating either signal as proof of completed baseline installation.

## Review and acceptance

A separate technical lead reviewed the proposed architecture before coding. The
accepted changes address ownership and prerequisite boundaries; they do not
increase timeouts, reset recovery budgets, suppress flakes, broaden IAM to
account administration, or weaken existing checks.

Verification must demonstrate the violating schedules fail before the fix and
pass afterward, retain neighboring valid behavior, and run the integrated
fifteen-gate `npm run check:ci` before the PR is pushed. Local checks cannot
establish production IAM readiness or resolve hosted macOS runner capacity.
