const fs = require("node:fs");

// Startup geometry and typography are inline. Keep the rest off the first-paint path,
// and retain a normal stylesheet for browsers with scripting disabled.
function deferStyles(file) {
  const html = fs.readFileSync(file, "utf8");
  fs.writeFileSync(
    file,
    html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, (link) =>
      link.includes("/static/css/")
        ? link.replace(
            /\s*\/?\s*>$/,
            " media=\"print\" data-app-style onload=\"this.media='all';this.removeAttribute('data-app-style')\" onerror=\"this.dataset.appStyleError='true';this.removeAttribute('data-app-style')\">",
          ) + `<noscript>${link}</noscript>`
        : link,
    ),
  );
}
module.exports = { deferStyles };
