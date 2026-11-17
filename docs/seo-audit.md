# SEO deployment and follow-up

The November 17, 2026 audit covered 34 canonical URLs. Search Console had only four
days of data (November 11–14): 4 clicks and 111 impressions. Query and click-through
observations are preliminary. Code changes in this PR need a production deployment
before their live acceptance checks can pass.

## Home delivery

New web visitors receive the shared title menu before downloading the simulation,
authentication, charts or manual. Choosing an action loads the existing game and
routes through its normal menu callbacks. Existing save databases, accounts, Apple touch-device install instructions,
interface preferences, installed apps and direct game links retain the full
bootstrap. Stored Firebase accounts resume automatically; new visitors initialize
Auth only when signing in. Popup transport initializes only for that sign-in.
The startup wordmark is a static high-priority image in the initial HTML, with
an early preload and a stored-theme-aware dark variant. The mounted menu reuses
that request. Startup CSS and the font faces are inline; a hashed 154 KB Latin subset replaces
the 352 KB full-font preload, with the original face retained for other scripts; the full stylesheet loads asynchronously before the
interactive menu is revealed. Analytics waits for that reveal and browser idle.
The publisher graph uses Person Todd Medema, confirmed by the owner.

## Hosting changes

The production workflow configures its existing AWS credentials and runs
`node scripts/hosting/deploy.js --preflight` **before any Firebase or AWS mutation**.
The readiness and hosting publisher steps receive the AWS credentials. This
read-only check needs no build. `scripts/deploy.sh ci-prod` also checks
readiness before building, checks built assets, then calls the publisher. Both use
`scripts/hosting/plan.js`, with production targets owned by
`scripts/hosting/targets.json`. The publisher rereads the current distribution,
function ETags and bucket website configuration immediately before uploading;
it never reuses an earlier preflight plan. It preserves origins,
forwarding settings, routing rules, cache policies, unrelated error responses, and
uses the distribution ETag to reject concurrent configuration changes.

The deploy assigns cache lifetimes from `scripts/hosting/policy.js`:

- Hashed JavaScript/CSS/fonts and InterVariable.woff2: one year, immutable. **Rename the
  font and update its references if its bytes change**; an immutable URL cannot
  safely serve a replacement font.
- Unhashed analytics.js and inter.css: one week.
- Images and audio: six months.
- HTML, sitemap, robots, llms, and other mutable files: five minutes with revalidation.
- package.json: no-cache, retaining the update/version check's existing behavior.

CloudFront functions redirect only known sitemap pages from clean or trailing-slash
aliases to their `.html` canonical URL, and `/index.html` to `/`. Query parameters
survive redirects. Unknown URLs still return 404; the bucket error document and
CloudFront 404 response now use the small `404.html` page with `noindex` metadata.
The response function adds `X-Robots-Tag: noindex` to `/data/*` and one-year HSTS.
HSTS deliberately omits `includeSubDomains` until the owner confirms every subdomain
is HTTPS-only. Raw data remains allowed in robots.txt so crawlers can read noindex.

The deploy refuses to replace a foreign viewer function, combine viewer
Lambda@Edge with CloudFront Functions, overwrite a same-name function it does not
own, or deploy through a cache policy that clamps lifetimes outside
300–31536000 seconds. An operator must integrate existing viewer behavior or adjust
that policy first. The deploy does not silently remove these protections. Function
updates use their ETags too. It waits for distribution propagation and the cache
invalidation before the workflow runs the live smoke check.

### Production prerequisite rollout

The November 17 deployment failed on `cloudfront:GetDistributionConfig` for IAM
user `electrify-gh-actions` in account `028836220400`, after Firebase had already
deployed. Merging this change alone does **not** grant that identity permissions or
provision the two required functions. An operator must complete this rollout before
rerunning the production workflow. No production IAM or hosting configuration was
changed while preparing this fix.

The versioned release contract is `scripts/hosting/deployment-policy.v1.json`
(`ElectrifyHostingPublisherV1`). It grants distribution operations only on
`E38D57AILAHD00`, website configuration only on `electrifygame.com`, object uploads
and failed multipart cancellation only under that bucket, and function
Describe/Update/Publish only on `electrify-seo-request` and
`electrify-seo-response`. Cache-policy reads allow that resource type across
accounts so an attached AWS-managed policy can also be inspected; no cache-policy
writes are granted. Waiters require GetDistribution and GetInvalidation. The
local-file S3 copy needs PutObject and AbortMultipartUpload, including cancellation
after an interrupted multipart upload; it does not request ACLs, delete objects or
read object contents. GetCallerIdentity authenticates the selected account and
[requires no IAM allow](https://docs.aws.amazon.com/STS/latest/APIReference/API_GetCallerIdentity.html).
Action/resource mappings follow the
[CloudFront authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudfront.html)
and [S3 operation permissions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html).

From the repository root, an IAM administrator can review the versioned policy
and run this block to verify the account and principal before attachment.

```sh
(
  set -eu
  account=$(aws --profile production-admin sts get-caller-identity --query Account --output text)
  user_arn=$(aws --profile production-admin iam get-user --user-name electrify-gh-actions --query User.Arn --output text)
  if [ "$account" != 028836220400 ] || [ "$user_arn" != arn:aws:iam::028836220400:user/electrify-gh-actions ]; then
    echo 'Expected the production account and electrify-gh-actions IAM user' >&2
    exit 1
  fi
  aws --profile production-admin iam put-user-policy \
    --user-name electrify-gh-actions \
    --policy-name ElectrifyHostingPublisherV1 \
    --policy-document file://scripts/hosting/deployment-policy.v1.json
)
```

Reconcile any legacy attached policies separately: adding this inline policy does
not remove broader existing grants. Organization policies, permissions boundaries,
explicit denies and bucket policy restrictions can still prevent writes.

CloudFront CreateFunction cannot be scoped to named resources in IAM, so routine
release credentials deliberately lack it. An operator with provisioning access
must create missing functions once, using the current public sitemap and the same
function generators and ownership marker as releases:

```sh
node scripts/hosting/provision-functions.js --help
AWS_PROFILE=production-operator node scripts/hosting/provision-functions.js
AWS_PROFILE=production-release node scripts/hosting/deploy.js --preflight
```

Use profiles for account `028836220400`; `production-release` must select the same
identity as the workflow secrets. Provisioning checks the account, distribution,
cache policies and both function owners before creating anything. It creates only
missing functions in DEVELOPMENT and cleans up temporary code; it never overwrites,
publishes or associates an existing function. It refuses foreign ownership or
conflicting viewer associations. The next normal release uploads assets, updates
and publishes both functions, then associates them with the distribution. It does
not require them to be LIVE during preflight. If there is a conflict, integrate
the existing viewer behavior or cache-policy bounds explicitly before retrying.

A passing read-only preflight proves credentials can read the required live
configuration and that ownership/cache checks pass; it **does not prove write
authorization**. The policy artifact and fake-CLI contract tests cover the release's
required writes without granting IAM simulation or administration to the publisher.
After the operator rollout, rerun the production workflow and confirm its existing
post-deployment smoke check passes. A later configuration conflict or denial still
fails the publisher's fresh read before uploads; ETags continue to reject concurrent
configuration changes during publication.

## Verification

Run the page smoke check against a local HTTP build or production:

```sh
python3 scripts/seo-check.py http://127.0.0.1:3100
python3 scripts/seo-check.py https://electrifygame.com --hosting
```

Local checks fetch every page from the supplied origin, while requiring canonical
URLs to continue pointing to `https://electrifygame.com`. They reject redirects,
missing or duplicate sitemap entries, missing/invalid lastmod, duplicate titles or
descriptions, malformed/missing JSON-LD, incorrect canonical URLs, invalid snippet
lengths and anything other than one h1. `--hosting` additionally checks cache
headers, HSTS, data noindex, clean URL redirects, and the custom 404 response.
The production workflow runs this after every deploy and fails if any check fails.

Sitemap dates come from `site/source-dates.json`, which pairs each authored source's
SHA-256 with its actual change date. Initial records use the source's last Git
author date. When editing an HTML source, scenario content or its template, run
`npm run site:generate -- --date YYYY-MM-DD` with the actual authored-change date,
then commit the source, date records and generated output together. Only changed
sources get that date; unchanged sources keep theirs. For edits made on different
dates, generate after each day's source edits. Generation and `site:check` reject
changed sources without matching records, and reject invalid, future or decreasing
dates. Ordinary regeneration never invents a date from the build clock. Dates stay
stable after commits, squash merges, fresh checkouts and generated-only changes.

The CloudFront configuration and functions are tested through generated function
execution and a fake AWS CLI; no tooling test modifies AWS. The Python checker is
also exercised against local HTTP fixtures with deliberately broken pages,
sitemaps and response statuses. Analytics tests verify that neither early events
nor reconnects can fetch Google's tag before window load and idle; queued events,
retry behavior, and native-client exclusions remain covered.

After deployment, run three mobile Lighthouse measurements on `/` and
`/power-grid-simulator.html` and compare medians. Home targets: Performance ≥85,
LCP ≤2.5 seconds, TBT ≤300 ms; desktop Performance ≥95. Content pages should retain
Performance 100 and target Accessibility ≥98. These are live measurements, not
claims established by local code tests. Validate JSON-LD with the Schema Markup
Validator and inspect rendered home links through Search Console's live URL test.

## Verified existing configuration

On November 17, 2026, read-only HTTP checks found **404 Site Not Found** at all four
default domains: `electrify-game.firebaseapp.com`, `electrify-game.web.app`,
`electrifygame.firebaseapp.com`, and `electrifygame.web.app`. None served a duplicate
of the game, so no Firebase Hosting redirect was needed. The configured Firebase
project is **electrify-game**; the audit had omitted the hyphen. Keep Firebase Auth's
reserved `/__/auth/*` endpoints working if Hosting is added later.

The GitHub repository Website field already contained `https://electrifygame.com`
and README already linked the playable game; neither needed a replacement link.
No repository metadata mutation was necessary.

## Owner actions

- Submit `https://electrifygame.com/sitemap.xml` in Search Console → Sitemaps and
  confirm the discovered URL count matches the published sitemap.
- Request indexing for `/classroom.html`, then reinspection of
  `/power-grid-simulator.html` and `/` after the changes ship. Confirm the rendered
  home contains the classroom and how-to-play links.
- Recheck Search Console → Links once processing finishes. Build a baseline of
  referring domains, then consider itch.io, educational directories, teacher
  resource lists and relevant simulator maintainers. Add Steam when a page exists.
- Publisher was confirmed as Person Todd Medema. Keep that entity consistent;
  do not fabricate ratings or reviews.
- Before enabling HSTS includeSubDomains, inventory and test HTTPS on every active
  subdomain. Current code applies HSTS only to the serving hostname.
- Before the first deploy, verify the production identity's new permissions,
  existing viewer functions, cache-policy bounds, and configured distribution ID
  as described above. Run the post-deploy smoke check and live Lighthouse/markup
  validations; local tests do not establish live header or performance results.

Re-audit around **December 15, 2026**, using a full 28-day Search Console window:
index coverage for every sitemap URL, successful sitemap processing, rendered
home links, breadcrumbs/markup validation, available field Core Web Vitals,
power-grid-simulator query impressions/CTR/position, and new referring domains.
