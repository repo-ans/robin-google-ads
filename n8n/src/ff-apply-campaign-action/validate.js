// @include shared/input.js
// Body: { source: "chat" | "message", source_id }
// Only the row id comes from the browser. The action itself is read from the
// database (the reference trusted the browser's copy of proposed_action).
const b = requestBody();
if (!['chat', 'message'].includes(b.source)) return reject(400, 'source must be chat or message.');
if (!isUuid(b.source_id)) return reject(400, 'source_id is missing or not valid.');
return [{ json: { valid: true, source: b.source, source_id: b.source_id } }];
