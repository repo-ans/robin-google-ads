// @include shared/gads.js
// @include ff-case-match/results.js
// Results of the validateOnly calls (one per upload kind), matched to their
// request with itemMatching(i), never by position. Decides whether the real
// upload runs: only for action "upload", and only if no request failed as a whole.
const plan = $('Plan uploads').first().json;
const results = {};
$input.all().forEach((item, i) => {
  const req = $('Upload requests').itemMatching(i).json;
  results[req.kind] = readUpload(item.json, req.sent);
});
const requestFailed = Object.values(results).some((r) => r.error);
const accepted = Object.values(results).reduce((s, r) => s + r.accepted, 0);
return [{ json: { results, go: plan.action === 'upload' && !requestFailed && accepted > 0 } }];
