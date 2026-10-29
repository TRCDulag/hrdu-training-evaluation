// Local test server: serves index.html and answers its API calls with Code.gs running on the mock.
// Run: node dev/server.js  then open http://localhost:8787 and use http://localhost:8787/api as the app link (setup passcode 1234).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadBackend, seed } = require('./mock-gas');

function start(port) {
  const be = loadBackend(); seed(be);
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const out = be.code.doPost({ postData: { contents: body } });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(out.text);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    // The test page talks to /api on this server, like the real page talks to the /exec link.
    const t = new URL(req.url, 'http://x').searchParams.get('t') || '';
    let html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/const DEFAULT_URL = ".*?";/, 'const DEFAULT_URL = "http://localhost:' + port + '/api";');
    if (/^TE-\d{4}-\d{3,4}$/.test(t)) html = html.replace('/*BOOT*/""', JSON.stringify(t));
    res.end(html);
  });
  return new Promise(ok => server.listen(port, () => ok({ server, be })));
}
if (require.main === module) start(+process.env.PORT || 8787).then(() => console.log('http://localhost:' + (+process.env.PORT || 8787)));
module.exports = { start };
