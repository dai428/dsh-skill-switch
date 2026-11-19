import https from 'node:https';
const r = https.request({ hostname:'registry.npmjs.org', path:'/-/v1/login', method:'POST',
  headers:{ 'user-agent':'npm/10.9.9 node/v22.23.5 win32 x64 workspaces/false','content-type':'application/json','content-length':2,'accept':'application/json' }, timeout:45000 },
  (res)=>{ let b=''; res.on('data',c=>b+=c); res.on('end',()=>{ console.log('status',res.statusCode); console.log(JSON.stringify(res.headers,null,1)); console.log('body',b.slice(0,300)); }); });
r.on('error',e=>console.log('err',e.message));
r.write('{}'); r.end();