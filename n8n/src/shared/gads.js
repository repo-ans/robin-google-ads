// ---- shared/gads.js (included by scripts/build-n8n.mjs) -------------------
// Reading Google Ads REST responses from an HTTP Request node that has
// "Full response" on (and usually "Never error"), with the body as text or JSON.

function gadsBody(r) {
  let body = r && (r.body !== undefined ? r.body : r.data);
  if (typeof body === 'string') {
    try {
      body = body ? JSON.parse(body) : null;
    } catch (e) {
      return { __unparsable: true };
    }
  }
  return body;
}

// Human-readable error from a failed call, or null when it succeeded.
function gadsError(r) {
  if (!r) return 'no response';
  if (r.error && r.statusCode === undefined) return String(r.error.message || JSON.stringify(r.error)).slice(0, 500);
  if (r.statusCode >= 200 && r.statusCode < 300) return null;
  const body = gadsBody(r);
  const first = Array.isArray(body) ? body[0] : body;
  const err = first && first.error;
  const detail = err && err.details && err.details[0] && err.details[0].errors && err.details[0].errors[0];
  const code = detail && detail.errorCode ? ` [${Object.values(detail.errorCode).join(',')}]` : '';
  return `${r.statusCode} ${(detail && detail.message) || (err && err.message) || 'error'}${code}`.slice(0, 500);
}

// searchStream / search -> { rows } or { error }.
function parseStream(r) {
  const error = gadsError(r);
  if (error) return { error };
  const body = gadsBody(r);
  if (body && body.__unparsable) return { error: 'response was not JSON' };
  const rows = [];
  for (const batch of Array.isArray(body) ? body : [body]) {
    for (const row of (batch && batch.results) || []) rows.push(row);
  }
  return { rows };
}
// ---- end shared/gads.js -----------------------------------------------------
