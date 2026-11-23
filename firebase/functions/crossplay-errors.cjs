class CrossplayError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function requireValue(condition, status = 400, code = "invalid_request") {
  if (!condition) throw new CrossplayError(status, code);
}

module.exports = { CrossplayError, requireValue };
