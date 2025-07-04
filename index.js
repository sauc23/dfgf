const http = require('http');
const cluster = require('cluster');
const os = require('os');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

// --- R2 Configuration ---
const R2_ENDPOINT = 'https://e369a3f4ccd7949a39e767db20807cb5.r2.cloudflarestorage.com';
const R2_ACCESS_KEY_ID = '00dc6cfaa4e288a07e0ae6a0038c0361';
const R2_SECRET_ACCESS_KEY = '24e9d7f5248ccadd1bad13ee7a47cfcd1cc44847da1d9084a73bb61f3d3cbc43';
const R2_REGION = 'auto';
const R2_BUCKET = 'chatlogs';

// --- Server Configuration ---
const PORT = 3000;
const TTL = 3600 * 1000; // 1 hour
const PREFIX = '/n9swecrlthotr7w8am/';

// Get the number of CPU cores
const numCPUs = os.cpus().length;

// --- Cluster Management ---
// The primary process forks a worker for each CPU core.
if (cluster.isPrimary) {
  console.log(`✅ Primary process ${process.pid} is running.`);
  console.log(`Forking server for ${numCPUs} CPUs.\n`);

  // Fork worker processes.
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.error(`❌ Worker ${worker.process.pid} died. Forking a new one...`);
    cluster.fork();
  });

} else {
  // --- Worker Process Logic ---
  // Each worker process runs its own server instance.

  const cache = {}; // Each worker has its own cache.

  // Initialize the S3 client once per worker. The SDK manages connection pooling.
  const s3Client = new S3Client({
    region: R2_REGION,
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      setCORSHeaders(res);
      res.writeHead(204);
      return res.end();
    }

    const reqPath = decodeURIComponent(req.url);
    if (!reqPath.startsWith(PREFIX)) {
      setCORSHeaders(res);
      res.writeHead(403, { 'Content-Type': 'text/html' });
      return res.end(getCustomErrorPage(403, 'Access Denied'));
    }

    const objectKey = reqPath.slice(PREFIX.length);
    const now = Date.now();

    // 1. Check cache first for instant response
    if (cache[objectKey] && now - cache[objectKey].timestamp < TTL) {
      const { headers, body } = cache[objectKey];
      setCORSHeaders(res);
      res.writeHead(200, headers);
      return res.end(body);
    }

    try {
      // 2. Fetch object metadata and stream from R2
      const command = new GetObjectCommand({ Bucket: R2_BUCKET, Key: objectKey });
      const s3Response = await s3Client.send(command);

      const responseHeaders = {
        'Content-Type': s3Response.ContentType || 'application/octet-stream',
        'Cache-Control': `public, max-age=${TTL / 1000}`,
        'Content-Length': s3Response.ContentLength,
        'ETag': s3Response.ETag,
      };

      // For smaller files, we can still cache them fully in memory.
      // For very large files, you might skip caching to save memory.
      // Here, we'll continue to buffer and cache for simplicity and performance on repeated requests.
      const body = await streamToBuffer(s3Response.Body);
      
      cache[objectKey] = {
        timestamp: now,
        headers: responseHeaders,
        body: body,
      };
      
      setCORSHeaders(res);
      res.writeHead(200, responseHeaders);
      res.end(body);
      
    } catch (err) {
      handleError(res, err);
    }
  });

  server.listen(PORT, () => {
    console.log(`🚀 Worker ${process.pid} started and listening on port ${PORT}`);
  });
}


// --- Helper Functions ---

function handleError(res, err) {
  setCORSHeaders(res);
  if (err.name === 'NoSuchKey') {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    return res.end(getCustomErrorPage(404));
  }
  res.writeHead(500, { 'Content-Type': 'text/html' });
  res.end(getCustomErrorPage(500, err));
}

function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function getCustomErrorPage(status, err = null) {
  const messages = {
    403: "403 Forbidden",
    404: "404 Not Found",
    500: "500 Internal Server Error",
  };
  const msg = messages[status] || `${status} Error`;
  return `<!DOCTYPE html><html><head><title>${msg}</title><style>body{font-family:sans-serif;background:#111;color:#eee;padding:2em}h1{color:#f55}</style></head><body><h1>${msg}</h1><p>${err ? 'Details: ' + err.message : 'The requested content could not be retrieved.'}</p></body></html>`;
}
