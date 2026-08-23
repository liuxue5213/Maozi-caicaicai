const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const WEB_ROOT = path.join(__dirname, 'client', 'dist');
const API_HOST = 'localhost';
const API_PORT = 60205;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);
  const pathname = parsedUrl.pathname;

  // 代理 API 请求到后端
  if (pathname.startsWith('/api/') || pathname.startsWith('/ws')) {
    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `${API_HOST}:${API_PORT}`,
      },
    };

    // 移除可能导致问题的头
    delete options.headers['connection'];
    delete options.headers['transfer-encoding'];

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
      console.error('代理请求错误:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '后端服务不可用' }));
    });

    req.pipe(proxyReq, { end: true });
    return;
  }

  // 静态文件服务
  let filePath = path.join(WEB_ROOT, pathname === '/' ? 'index.html' : pathname);

  // 如果文件不存在，返回 index.html（SPA 路由支持）
  if (!fs.existsSync(filePath)) {
    filePath = path.join(WEB_ROOT, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    // 禁用缓存，确保加载最新文件
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(data);
  });
});

const PORT = 60200;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Web Server] 启动成功: http://localhost:${PORT}`);
  console.log(`[API Proxy] 代理到: http://${API_HOST}:${API_PORT}`);
});
