import https from 'node:https';
function post(body) {
  return new Promise((resolve) => {
    const r = https.request({
      hostname: 'registry.npmjs.org', path: '/-/v1/login', method: 'POST',
      headers: { 'user-agent': 'npm/10.9.9 node/v22.23.5 win32 x64 workspaces/false',
        'content-type': 'application/json', 'npm-command': 'login',
        'content-length': Buffer.byteLength(body), accept: 'application/json' },
      timeout: 45000,
    }, (res) => { let b=''; res.on('data',c=>b+=c); res.on('end',()=>resolve({status:res.statusCode, headers:res.headers, body:b})); });
    r.on('timeout',()=>{r.destroy();resolve({status:0,body:'timeout'});});
    r.on('error',(e)=>resolve({status:0,body:String(e.message)}));
    r.write(body); r.end();
  });
}
for (const b of ['{}', '']) {
  const res = await post(b);
  console.log('body=' + JSON.stringify(b), '->', res.status, res.body.slice(0,300));
}