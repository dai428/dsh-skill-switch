const NPM = 'C:/Tools/nodejs/node_modules/npm/node_modules';
const profile = require(NPM + '/npm-profile');
const regFetch = require(NPM + '/npm-registry-fetch');

const opts = { registry: 'https://registry.npmjs.org', fetch, ...regFetch.defaultOpts ? {} : {} };
const opener = async (url) => { console.log('LOGIN_URL=' + url); };

profile.login(opener, null, { registry: 'https://registry.npmjs.org', creds: {}, fetch })
  .then(r => { console.log('TOKEN=' + r.token); console.log('USER=' + r.username); })
  .catch(e => console.log('ERR ' + (e && e.message) + ' status=' + (e && e.statusCode)));