// Install dependencies:
// npm install express axios node-cache

const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');

const app = express();
const port = 3000;

// Cache: 1 hour TTL
const cache = new NodeCache({ stdTTL: 3600 });
const ORIGIN = 'https://pub-ad6cd63cac2b4eb7b32b6806a1af5f09.r2.dev';

app.get('/*', async (req, res) => {
  const path = req.params[0];
  const targetUrl = `${ORIGIN}/${path}`;

  // Check cache
  if (cache.has(path)) {
    const cached = cache.get(path);
    res.set(cached.headers);
    return res.status(200).send(cached.data);
  }

  try {
    const response = await axios.get(targetUrl, {
      responseType: 'arraybuffer', // support binary files
      headers: {
        'User-Agent': 'Node-Proxy-Cache',
      },
      validateStatus: () => true, // Allow all statuses
    });

    const { status, data, headers } = response;

    if (status >= 400) {
      return res.status(status).send(getCustomErrorPage(status));
    }

    // Store in cache
    cache.set(path, {
      data,
      headers: {
        'Content-Type': headers['content-type'] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600',
      }
    });

    res.set({
      'Content-Type': headers['content-type'] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
    });

    return res.send(data);
  } catch (err) {
    return res.status(500).send(getCustomErrorPage(500, err));
  }
});

// Error page generator
function getCustomErrorPage(status, err) {
  const titles = {
    400: "400 Bad Request",
    401: "401 Unauthorized",
    403: "403 Forbidden",
    404: "404 Not Found",
    500: "500 Internal Server Error",
  };
  const msg = titles[status] || `${status} Error`;

  return `
    <!DOCTYPE html>
    <html>
    <head><title>${msg}</title><style>
      body { font-family: sans-serif; background: #111; color: #eee; padding: 2em; }
      h1 { color: #f55; }
    </style></head>
    <body>
      <h1>${msg}</h1>
      <p>${err ? "Details: " + err.message : "The requested content could not be retrieved."}</p>
    </body>
    </html>
  `;
}

app.listen(port, () => {
  console.log(`Proxy running on http://localhost:${port}`);
});
