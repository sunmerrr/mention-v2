// Managed local preview: serve the Nest SSR tree on the template's web port.
import http from 'node:http';
const server = http.createServer((request, response) => {
  const upstream = http.request({ hostname: '127.0.0.1', port: 4200, path: request.url, method: request.method, headers: request.headers }, (result) => {
    response.writeHead(result.statusCode || 503, result.headers);
    result.pipe(response);
  });
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Nest 서버 연결을 확인해 주세요.');
  });
  request.on('aborted', () => upstream.destroy());
  request.pipe(upstream);
});
server.listen(5173, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  const timer = setTimeout(() => process.exit(1), 25000); timer.unref();
  server.close(() => { clearTimeout(timer); process.exit(0); });
});
