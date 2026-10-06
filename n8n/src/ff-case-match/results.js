// ---- ff-case-match/results.js (included by check.js and records.js) -------
// Reads an upload*Conversions response (full response, partialFailure on).
// Returns counts and error-code names only - never row data, because Google's
// messages can echo a click id.
function readUpload(resp, sent) {
  const out = { sent, accepted: 0, rejected: 0, reasons: {}, error: null };
  const requestError = gadsError(resp);
  if (requestError) {
    out.error = requestError.replace(/[A-Za-z0-9_-]{30,}/g, '[id]');
    out.rejected = sent;
    return out;
  }
  const body = gadsBody(resp) || {};
  const pf = body.partialFailureError;
  const bad = new Set();
  for (const d of (pf && pf.details) || []) {
    for (const e of d.errors || []) {
      const path = ((e.location && e.location.fieldPathElements) || []).find((f) => f.fieldName === 'conversions');
      const idx = path ? Number(path.index || 0) : -1;
      const code = e.errorCode ? Object.values(e.errorCode)[0] : 'UNKNOWN';
      if (idx >= 0) bad.add(idx);
      out.reasons[code] = (out.reasons[code] || 0) + 1;
    }
  }
  out.rejected = Math.min(sent, bad.size);
  out.accepted = sent - out.rejected;
  return out;
}
// ---- end ff-case-match/results.js -------------------------------------------
