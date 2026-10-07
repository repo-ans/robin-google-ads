// The website code for one client, filled from Google Ads (the AW-.../label values
// come from the sync), and the short note for whoever edits the client's website.

export type WebsiteValues = {
  website_call_send_to: string | null;
  form_send_to: string | null;
  purchase_send_to: string | null;
  start_send_to: string | null;
};

export function websiteSnippet(v: WebsiteValues, phone: string | null, online: boolean) {
  const sendTo = v.website_call_send_to || v.form_send_to || v.purchase_send_to;
  const tagId = sendTo ? sendTo.split("/")[0] : "AW-XXXXXXXXX";
  const lines = [
    `<!-- Google tag (skip if the site already has it for ${tagId}) -->`,
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${tagId}"></script>`,
    `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${tagId}',{allow_enhanced_conversions:true});</script>`,
    `<!-- FF code: keeps the ad click, fills the GHL form, shows Google's call tracking number${online ? ", counts paid arrangements" : ""} -->`,
    `<script src="${window.location.origin}/ff-click-id.js" defer`,
    ...(v.website_call_send_to && phone ? [`  data-phone-conversion="${v.website_call_send_to}" data-phone="${phone}"`] : []),
    ...(v.form_send_to && !online ? [`  data-form-conversion="${v.form_send_to}" data-thank-you-path="/thank-you-preplanning"`] : []),
    ...(online && v.start_send_to ? [`  data-start-conversion="${v.start_send_to}" data-start-path="/arrange"`] : []),
    ...(online && v.purchase_send_to ? [`  data-purchase-conversion="${v.purchase_send_to}" data-purchase-path="/order-confirmed" data-currency="USD"`] : []),
    `></script>`,
    ...(online
      ? [
        `<!-- On the confirmation page, after a confirmed payment, the checkout calls (nothing about the person who died):`,
        `     ffPurchase({ value: <amount paid>, order_id: '<order number>', email: '<buyer email>', phone: '<buyer phone>' })`,
        `     Change /arrange and /order-confirmed above to the real pages. -->`,
      ]
      : ["<!-- Change /thank-you-preplanning above to the page the form opens after it is sent. -->"]),
  ];
  return lines.join("\n");
}

export function websiteNote(clientName: string, online: boolean, snippet: string) {
  return [
    `Hello - Funeral Futurist manages the Google Ads for ${clientName}. To count calls, form requests${online ? " and online arrangements" : ""} from the ads, please add the code below to the website.`,
    "",
    "1. Paste it once, just before </body>, so it is on every page (WordPress: a footer code plugin such as WPCode; or a Custom HTML tag in Google Tag Manager, all pages).",
    online
      ? "2. On the page the family sees after a confirmed payment, call ffPurchase(...) as shown in the last comment, with the amount paid and the order number. Never pass anything about the person who died."
      : "2. Tell us the address of the page the preplanning form opens after it is sent (the thank-you page).",
    "3. Nothing else changes on the site. The code keeps no personal data.",
    "",
    snippet,
  ].join("\n");
}
