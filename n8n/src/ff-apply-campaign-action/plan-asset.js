// @include shared/gads.js
// Call tracking, step B: after step A (account settings + call conversion
// actions) is applied, build the account-level call asset. It needs the
// resource name of "Calls from ads 90s+", which step A may have just created -
// read from step A's answer, matched to its request with itemMatching(i).
// Output: { need: false, reason } or { need: true, body } for googleAds:mutate.
const plan = $('Plan change').first().json;
const t = plan.tracking;
const cid = plan.customer_id;
const ran = (name) => {
  try {
    return $(name).all();
  } catch (e) {
    return null; // step A did not run (nothing to change there)
  }
};

let adCallAction = t.ad_call_action;
const applied = ran('Apply tracking');
if (applied) {
  for (let i = 0; i < applied.length; i++) {
    const req = $('Tracking: real requests').itemMatching(i).json;
    const err = gadsError(applied[i].json);
    if (err) return [{ json: { need: false, failed: true, reason: `step A failed: ${err}` } }];
    if (req.label === 'conversion_actions') {
      const results = (gadsBody(applied[i].json) || {}).results || [];
      (req.op_types || []).forEach((type, k) => {
        if (type === 'AD_CALL' && results[k] && results[k].resourceName) adCallAction = results[k].resourceName;
      });
    }
  }
}

if (!t.need_asset) return [{ json: { need: false, reason: 'the account already has a call asset' } }];
if (!adCallAction) return [{ json: { need: false, failed: true, reason: 'no "Calls from ads 90s+" action to count the calls' } }];

const asset = `customers/${cid}/assets/-1`;
return [{
  json: {
    need: true,
    body: {
      mutateOperations: [
        {
          assetOperation: {
            create: {
              resourceName: asset,
              callAsset: {
                countryCode: t.country_code || 'US',
                phoneNumber: t.phone,
                callConversionReportingState: 'USE_RESOURCE_LEVEL_CALL_CONVERSION_ACTION',
                callConversionAction: adCallAction,
              },
            },
          },
        },
        { customerAssetOperation: { create: { asset, fieldType: 'CALL' } } },
      ],
    },
  },
}];
