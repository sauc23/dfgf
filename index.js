const http = require('http');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// --- R2 Configuration ---
const R2_ENDPOINT = 'https://2ee1e6e359bd0e2b8dde508e2efd1c7d.r2.cloudflarestorage.com'
const R2_ACCESS_KEY_ID = '7288a7d681f64fca3e9da9002d740b5d'
const R2_SECRET_ACCESS_KEY = 'eda8800b8a31f18c5bca2ca5878696f27cb2257e990d2cf13969be9e49c8fde9'
const R2_REGION = 'auto'
const R2_BUCKET = 'bone'

// --- Server Configuration ---
const PREFIX = '/n9swecrlthotr7w8am/';
const SIGNED_URL_EXPIRES_IN = 300; // Time in seconds (e.g., 300 = 5 minutes)

// Initialize the S3 client for R2
const s3Client = new S3Client({
  region: R2_REGION,
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
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

  // The object key in R2 is the path after the prefix
  const objectKey = reqPath.slice(PREFIX.length);

  try {
    // Prepare the command to get an object
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: objectKey,
    });

    // Create a pre-signed URL
    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: SIGNED_URL_EXPIRES_IN,
    });

    // Redirect the client to the pre-signed URL
    setCORSHeaders(res);
    res.setHeader('Location', signedUrl);
    res.writeHead(302); // 302 Found (Temporary Redirect)
    res.end();

  } catch (err) {
    // This will catch errors during the URL signing process
    setCORSHeaders(res);
    console.error('Error generating signed URL:', err);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(getCustomErrorPage(500, err));
  }
});

server.listen(3000, () => {
  console.log(`Redirect server running. Accessing a URL will generate a signed R2 link.`);
  console.log(`http://localhost:3000${PREFIX}:object-key`);
});

/**
 * Sets standard CORS headers for the response.
 * @param {http.ServerResponse} res The response object.
 */
function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
}

/**
 * Generates a custom HTML error page.
 * @param {number} status The HTTP status code.
 * @param {Error|null} err An optional error object.
 * @returns {string} HTML string for the error page.
 */
function getCustomErrorPage(status, err = null) {
  const messages = {
    403: "403 Forbidden",
    404: "404 Not Found", // Note: 404s will happen on the R2 side, not here.
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
  <p>${err ? 'Details: ' + err.message : 'Could not process the request.'}</p>
</body>
</html>`;
}
