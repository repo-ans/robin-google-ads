// Totals for the sync_runs row. Input: this run's sync_run_accounts rows
// ("Load run results" has alwaysOutputData on, so an empty run is one empty item).
const run = $('Start sync run').first().json;
const rows = $input.all().map((i) => i.json).filter((r) => r && r.status);

const ok = rows.filter((r) => r.status === 'ok').length;
const partial = rows.filter((r) => r.status === 'partial').length;
const failed = rows.filter((r) => r.status === 'failed').length;

let status = 'ok';
if (partial > 0 || failed > 0) status = 'partial';
if (rows.length > 0 && failed === rows.length) status = 'failed';

return [{
  json: {
    sync_run_id: run.id,
    accounts_total: rows.length,
    accounts_ok: ok + partial,
    accounts_failed: failed,
    accounts_partial: partial,
    patch: {
      finished_at: new Date().toISOString(),
      status,
      accounts_ok: ok + partial,
      accounts_failed: failed,
      // Read-only sync: there is no write path to Google Ads in this workflow.
      mutate_calls: 0,
    },
  },
}];
