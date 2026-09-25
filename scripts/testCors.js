import http from 'http';

const options = {
  hostname: '127.0.0.1',
  port: 5000,
  path: '/api/uploads/product-image',
  method: 'GET',
  headers: {
    Origin: 'http://localhost:5173'
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('status', res.statusCode);
    console.log('Access-Control-Allow-Origin', res.headers['access-control-allow-origin']);
    console.log('Access-Control-Allow-Credentials', res.headers['access-control-allow-credentials']);
    console.log('body', body.slice(0, 200));
  });
});
req.on('error', (e) => console.error('error', e.message));
req.end();
