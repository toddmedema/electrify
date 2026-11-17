# SEO deployment and follow-up

The November 17, 2026 audit covered 34 canonical URLs. Search Console had only four
days of data (November 11–14): 4 clicks and 111 impressions. Query and click-through
observations are preliminary. Code changes in this PR need a production deployment
before their live acceptance checks can pass.

## Hosting changes

`scripts/deploy.sh ci-prod` builds the game, checks its assets, then calls
`scripts/hosting/deploy.js`. The hosting step reads the current distribution and
bucket website configuration before uploading anything. It preserves origins,
forwarding settings, routing rules, cache policies, unrelated error responses, and
uses the distribution ETag to reject concurrent configuration changes.

The deploy assigns cache lifetimes from `scripts/hosting/policy.js`:

- Hashed JavaScript/CSS and InterVariable.woff2: one year, immutable. **Rename the
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

The production deploy identity now needs these permissions in addition to its
existing S3 upload and CloudFront invalidation access: CloudFront
GetDistributionConfig, UpdateDistribution, GetDistribution, GetCachePolicy,
DescribeFunction, CreateFunction, UpdateFunction, PublishFunction, GetInvalidation;
S3 GetBucketWebsite and PutBucketWebsite; and STS GetCallerIdentity. Scope writable
resources to the production distribution, bucket and `electrify-seo-*` functions.
Do not grant broad account administration to the deploy identity.

No production configuration was changed while preparing this code. The available
local AWS account could not read the production distribution ID configured in the
existing deploy script (`E38D57AILAHD00`); it returned `NoSuchDistribution`. Verify
permissions and any existing viewer associations using the **production deploy
identity** before the first deployment. A conflicting association fails before
uploads, with an actionable error.

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
CI uses complete Git history so page lastmod dates are not shallow-checkout dates.

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
- Confirm whether the publisher should remain Person Todd Medema or use a business
  entity. No ratings or reviews should be fabricated for structured data.
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
