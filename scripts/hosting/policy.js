// Shared by deployment and the generated CloudFront code. Match only authored URLs.
const CANONICAL_ORIGIN = "https://electrifygame.com";
const CACHE = {
  short: "public, max-age=300, must-revalidate",
  immutable: "public, max-age=31536000, immutable",
  moderate: "public, max-age=604800",
  media: "public, max-age=15552000",
};

function cacheControl(file) {
  if (file === "invite/index.html") return "no-store";
  if (
    /^static\/(?:js|css)\/[^/]+\.[a-f0-9]{8,}(?:\.chunk)?\.(?:js|css)(?:\.map|\.LICENSE\.txt)?$/.test(
      file,
    ) ||
    /^fonts\/inter\/InterVariable-latin\.[a-f0-9]{8}\.woff2$/.test(file) ||
    file === "fonts/inter/InterVariable.woff2"
  )
    return CACHE.immutable;
  if (["analytics.js", "fonts/inter/inter.css"].includes(file))
    return CACHE.moderate;
  if (/\.(?:mp3|wav|jpg|png|webp)$/.test(file)) return CACHE.media;
  return CACHE.short;
}

function canonicalPaths(xml) {
  const paths = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map((match) => {
    const url = new URL(match[1].trim());
    if (url.origin !== CANONICAL_ORIGIN || url.search || url.hash)
      throw new Error(`Unexpected sitemap URL: ${url}`);
    return url.pathname;
  });
  if (!paths.includes("/") || paths.length !== new Set(paths).size)
    throw new Error(
      "Sitemap must contain unique canonical URLs including home",
    );
  return paths;
}

function requestCode(paths) {
  const redirects = { "/index.html": "/" };
  for (const canonical of paths) {
    if (canonical === "/") continue;
    if (!canonical.endsWith(".html"))
      throw new Error(`Unexpected page: ${canonical}`);
    const clean = canonical.slice(0, -5);
    for (const alias of [clean, clean + "/", canonical + "/"])
      redirects[alias] = canonical;
  }
  // Keep query parameters, including repeats, so campaign/scenario links survive.
  return `function handler(event) {
  var request = event.request;
  if (request.uri === '/invite/') {
    request.uri = '/invite/index.html';
    return request;
  }
  var redirects = ${JSON.stringify(redirects)};
  var target = Object.prototype.hasOwnProperty.call(redirects, request.uri) ? redirects[request.uri] : null;
  if (!target) return request;
  var query = [];
  var params = request.querystring || {};
  Object.keys(params).forEach(function(key) {
    var values = params[key].multiValue || [params[key]];
    values.forEach(function(item) { query.push(key + '=' + item.value); });
  });
  return { statusCode: 301, statusDescription: 'Moved Permanently', headers: {
    location: { value: target + (query.length ? '?' + query.join('&') : '') },
    'cache-control': { value: '${CACHE.short}' },
    'strict-transport-security': { value: 'max-age=31536000' }
  } };
}`;
}

function responseCode() {
  // includeSubDomains requires an owner inventory of every subdomain first.
  return `function handler(event) {
  var response = event.response;
  response.headers['strict-transport-security'] = { value: 'max-age=31536000' };
  if (event.request.uri === '/invite/' || event.request.uri === '/invite/index.html')
    response.headers['referrer-policy'] = { value: 'no-referrer' };
  if (event.request.uri.indexOf('/data/') === 0)
    response.headers['x-robots-tag'] = { value: 'noindex' };
  return response;
}`;
}

function patchDistribution(original, functions) {
  const config = structuredClone(original);
  const behaviors = [
    config.DefaultCacheBehavior,
    ...(config.CacheBehaviors?.Items || []),
  ];
  for (const behavior of behaviors) {
    const associations = behavior.FunctionAssociations?.Items || [];
    for (const [event, arn] of Object.entries(functions)) {
      const existing = associations.find((item) => item.EventType === event);
      const lambda = behavior.LambdaFunctionAssociations?.Items?.find((item) =>
        item.EventType.startsWith("viewer-"),
      );
      if (lambda || (existing && existing.FunctionARN !== arn))
        throw new Error(
          `Existing ${event} function on ${behavior.PathPattern || "default"}; integrate SEO into it before deploying`,
        );
      if (!existing) associations.push({ EventType: event, FunctionARN: arn });
    }
    behavior.FunctionAssociations = {
      Quantity: associations.length,
      Items: associations,
    };
    // With a cache policy this is checked separately against its live MinTTL.
    if (!behavior.CachePolicyId) {
      behavior.MinTTL = 0;
      behavior.MaxTTL = Math.max(behavior.MaxTTL || 0, 31536000);
    }
  }
  const errors = config.CustomErrorResponses?.Items || [];
  const custom404 = {
    ErrorCode: 404,
    ResponsePagePath: "/404.html",
    ResponseCode: "404",
    ErrorCachingMinTTL: 60,
  };
  const index = errors.findIndex((item) => item.ErrorCode === 404);
  if (index < 0) errors.push(custom404);
  else errors[index] = custom404;
  config.CustomErrorResponses = { Quantity: errors.length, Items: errors };
  return config;
}

module.exports = {
  CACHE,
  cacheControl,
  canonicalPaths,
  requestCode,
  responseCode,
  patchDistribution,
};
