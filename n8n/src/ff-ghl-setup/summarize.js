// Results of "GHL: create" (one per missing field or tag). Matched to the plan
// by name from GHL's answer (never by array index): whatever was planned and
// does not come back created has failed.
const plan = $('Plan').all().map((i) => i.json);
const created = new Set();
for (const res of $input.all().map((i) => i.json || {})) {
  if (!(res.statusCode >= 200 && res.statusCode < 300) || !res.body) continue;
  const f = res.body.customField || res.body.customfield;
  if (f && f.name) created.add(`field ${String(f.name).toLowerCase()}`);
  if (res.body.tag && res.body.tag.name) created.add(`tag ${String(res.body.tag.name).toLowerCase()}`);
}
const made = plan.filter((p) => created.has(p.what)).map((p) => p.what);
const failed = plan.filter((p) => !created.has(p.what)).map((p) => p.what);
const message = failed.length
  ? `Created ${made.length ? made.join(', ') : 'nothing'}; could not create ${failed.join(', ')}. Check the FF GHL key's scopes, then run Check GHL.`
  : `Created in GHL: ${made.join(', ')}. Next: add them to the preplanning form as hidden fields.`;
return [{ json: { status: failed.length ? 502 : 200, body: { ok: !failed.length, created: made, failed, message } } }];
