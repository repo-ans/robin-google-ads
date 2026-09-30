// @include shared/input.js
// Body: { query: "mount pleasant sc", country?: "US" }
const b = requestBody();
const query = text(b.query, 80);
if (query.length < 2) return reject(400, 'Type at least 2 characters.');
const country = typeof b.country === 'string' && /^[A-Za-z]{2}$/.test(b.country) ? b.country.toUpperCase() : null;
return [{ json: { valid: true, query, country } }];
