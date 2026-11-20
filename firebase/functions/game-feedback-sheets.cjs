const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

class SheetsServiceError extends Error {
  constructor(stage, status) {
    super(`Feedback ${stage} failed`);
    this.stage = stage;
    this.status = status;
  }
}

async function requestJson(stage, send, url, options) {
  let response;
  try {
    response = await send(url, options);
    if (response.ok) return await response.json();
  } catch {
    throw new SheetsServiceError(stage);
  }
  throw new SheetsServiceError(stage, response.status);
}

function createSheetsTokenProvider(getWriter, getRuntimeToken, send = fetch) {
  let cached;
  let pending;

  async function mintToken() {
    const writer = getWriter();
    const runtimeToken = await getRuntimeToken().catch(() => {
      throw new SheetsServiceError("runtime authorization");
    });
    const name = `projects/-/serviceAccounts/${encodeURIComponent(writer)}`;
    const { accessToken, expireTime } = await requestJson(
      "Sheets authorization",
      send,
      `https://iamcredentials.googleapis.com/v1/${name}:generateAccessToken`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(2_500),
        headers: {
          Authorization: `Bearer ${runtimeToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scope: [SHEETS_SCOPE] }),
      },
    );
    const expiresAt = Date.parse(expireTime);
    if (
      typeof accessToken !== "string" ||
      !accessToken ||
      !Number.isFinite(expiresAt)
    ) {
      throw new SheetsServiceError("Sheets authorization response");
    }
    cached = { accessToken, expiresAt };
    return accessToken;
  }

  return async () => {
    if (cached?.expiresAt > Date.now() + 60_000) return cached.accessToken;
    pending ??= mintToken().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}

function createFeedbackSheets(spreadsheetId, token, send = fetch) {
  const valuesUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values`;

  function request(stage, path, signal, options) {
    return requestJson(stage, send, valuesUrl + path, {
      ...options,
      redirect: "error",
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
  }

  return {
    async hasSubmission(submissionId, signal) {
      const { values = [] } = await request(
        "Sheets lookup",
        `/${encodeURIComponent("Feedback!H2:H")}?valueRenderOption=UNFORMATTED_VALUE`,
        signal,
      );
      return values.some(([id]) => id === submissionId);
    },
    async appendRow(row, signal) {
      const { updates } = await request(
        "Sheets append",
        `/${encodeURIComponent("Feedback!A:H")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        signal,
        { method: "POST", body: JSON.stringify({ values: [row] }) },
      );
      if (updates?.updatedRows !== 1)
        throw new SheetsServiceError("Sheets append confirmation");
    },
  };
}

module.exports = {
  createFeedbackSheets,
  createSheetsTokenProvider,
  SheetsServiceError,
};
