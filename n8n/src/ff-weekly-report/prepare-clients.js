// One item per active client from ff_weekly_report (most spend first).
// { none: true } when there is nothing, so the loop is skipped cleanly.
const rows = $input.all().map((i) => i.json).filter((r) => r && r.client_id && r.week_start);
if (!rows.length) return [{ json: { none: true } }];
return rows.map((r) => ({ json: r }));
