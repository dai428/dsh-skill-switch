import https from 'node:https';
const agent = new https.Agent({ keepAlive: false });
function req(url, opts = {}, body) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const r = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: opts.method || 'GET',
      headers: { 'user-agent': 'npm/10.9.9 node/v22', accept: 'application/json', ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}) },
      timeout: 45000, agent,
    }, (res) => { let b=''; res.on('data', c=>b+=c); res.on('end', ()=>resolve({status:res.statusCode, body:b})); });
    r.on('timeout', ()=>{ r.destroy(); resolve({status:0, body:'timeout'}); });
    r.on('error', (e)=>resolve({status:0, body:String(e.message)}));
    if (body) r.write(body);
    r.end();
  });
}
const start = await req('https://registry.npmjs.org/-/v1/login', { method: 'POST' }, JSON.stringify({ hostname: 'www.npmjs.com' }));
console.log('status', start.status);
console.log(start.body.slice(0, 600));
if (start.status === 201 || start.status === 200) {
  const j = JSON.parse(start.body);
  console.log('LOGIN_URL=' + j.loginUrl);
  console.log('DONE_URL=' + j.doneUrl);
}