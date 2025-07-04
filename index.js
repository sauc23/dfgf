const http = require('http');
const https = require('https');
const { URL } = require('url');

const cache = {};
const TTL = 3600 * 1000; // 1 hour
const ORIGIN = 'https://pub-ad6cd63cac2b4eb7b32b6806a1af5f09.r2.dev';

const server = http.createServer(async (req, res) => {
  // Handle preflight CORS
  if (req.method === 'OPTIONS') {
    setCORSHeaders(res);
    res.writeHead(204);
    return res.end();
  }

  const reqPath = decodeURIComponent(req.url);
  const targetUrl = ORIGIN + reqPath;

  // Check cache
  const now = Date.now();
  if (cache[reqPath] && now - cache[reqPath].timestamp < TTL) {
    const { headers, body } = cache[reqPath];
    setCORSHeaders(res);
    res.writeHead(200, headers);
    return res.end(body);
  }

  try {
    const data = await proxyFetch(targetUrl);

    if (data.status >= 400) {
      setCORSHeaders(res);
      res.writeHead(data.status, { 'Content-Type': 'text/html' });
      return res.end(getCustomErrorPage(data.status));
    }

    const responseHeaders = {
      'Content-Type': data.headers['content-type'] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
    };

    // Cache it
    cache[reqPath] = {
      timestamp: now,
      headers: responseHeaders,
      body: data.body,
    };

    setCORSHeaders(res);
    res.writeHead(200, responseHeaders);
    res.end(data.body);
  } catch (err) {
    setCORSHeaders(res);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(getCustomErrorPage(500, err));
  }
});

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});

function proxyFetch(urlStr) {
  const url = new URL(urlStr);
  const lib = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Node-Proxy-Cache',
      }
    }, res => {
      const status = res.statusCode;
      const headers = res.headers;
      const chunks = [];

      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status,
          headers,
          body: Buffer.concat(chunks)
        });
      });
    });

    req.on('error', reject);
  });
}

function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
}

function getCustomErrorPage(status, err = null) {
  const messages = {
    400: "400 Bad Request",
    401: "401 Unauthorized",
    403: "403 Forbidden",
    404: "404 Not Found",
    500: "500 Internal Server Error",
  };

  const msg = messages[status] || `${status} Error`;

  return `<!DOCTYPE html>
<html>
<head><title>${msg}</title><style>
  body { font-family: sans-serif; background: #111; color: #eee; padding: 2em; }
  h1 { color: #f55; }
</style></head>
<body>
  <h1>${msg}</h1>
  <p>${err ? 'Details: ' + err.message : 'The requested content could not be retrieved.'}</p>
</body>
</html>`;
}
