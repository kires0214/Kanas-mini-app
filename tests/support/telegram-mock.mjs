// Loaded explicitly by the isolated HTTP test process; never imported by application source.
const networkFetch = globalThis.fetch;
globalThis.fetch = (input, options) => String(input).startsWith('https://api.telegram.org/bot')
  ? Promise.resolve(Response.json({ok:true,result:{message_id:1}}))
  : networkFetch(input, options);
