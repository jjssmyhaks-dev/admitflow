const https = require('https');

const token = process.env.GITHUB_TOKEN || '';
if (!token) {
  console.error('GITHUB_TOKEN not set — cannot create repo');
  process.exit(2);
}

const body = JSON.stringify({ name: 'admitflow', private: false, autoInitRepo: false });
const req = https.request({
  hostname: 'api.github.com',
  path: '/user/repos',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'admitflow-setup',
    'Authorization': `Bearer ${token}`,
    'Content-Length': Buffer.byteLength(body),
  },
}, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    console.log('status', res.statusCode, 'body', data.slice(0, 1500));
  });
});
req.on('error', (e) => console.error('err', e.code, e.message));
req.end(body);
