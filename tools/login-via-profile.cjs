const NPM = 'C:/Tools/nodejs/node_modules/npm/node_modules';
const profile = require(NPM + '/npm-profile');
const opener = async (url) => { console.log('LOGIN_URL=' + url); };
const opts = { registry: 'https://registry.npmjs.org', creds: {} };
profile.login(opener, null, opts)
  .then(r => { console.log('TOKEN=' + r.token); console.log('USER=' + r.username); })
  .catch(e => console.log('ERR ' + (e && e.message) + ' status=' + (e && e.statusCode)));