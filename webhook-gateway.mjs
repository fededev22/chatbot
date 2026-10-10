import http from 'node:http';
import {pathToFileURL} from 'node:url';

// El túnel de prueba apunta a este puerto: el panel no se publica.
export function createWebhookGateway(targetPort = 3000) {
  const gateway=http.createServer((req, res) => {
    let path;
    try{path=new URL(req.url,'http://localhost');}catch{req.resume();res.writeHead(400);return res.end('Solicitud inválida.');}
    if (path.pathname !== '/webhook' || !['GET', 'POST'].includes(req.method)) {
      res.writeHead(404, {'Content-Type':'text/plain', 'Cache-Control':'no-store'});
      req.resume();
      return res.end('Ruta no disponible.');
    }
    if(Number(req.headers['content-length'])>65536){req.resume();res.writeHead(413);return res.end('Solicitud demasiado grande.');}
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size <= 65536) chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > 65536) {
        res.writeHead(413);
        return res.end('Solicitud demasiado grande.');
      }
      const raw = Buffer.concat(chunks);
      const headers = {'content-length':raw.length};
      for (const name of ['content-type', 'x-hub-signature-256']) {
        if (req.headers[name]) headers[name] = req.headers[name];
      }
      const upstream = http.request({
        hostname:'127.0.0.1', port:targetPort, path:path.pathname + path.search,
        method:req.method, headers, timeout:15000,
      }, response => {
        res.writeHead(response.statusCode, {
          'Content-Type':response.headers['content-type'] || 'text/plain',
          'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff',
        });
        response.pipe(res);
        response.on('error', () => res.destroy());
      });
      upstream.on('timeout', () => upstream.destroy(new Error('Timeout')));
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end('Servidor no disponible.');
      });
      res.on('close', () => upstream.destroy());
      upstream.end(raw);
    });
    req.on('error', () => res.destroy());
  });
  gateway.requestTimeout=20000;gateway.headersTimeout=10000;gateway.keepAliveTimeout=5000;gateway.maxRequestsPerSocket=200;
  return gateway;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.WEBHOOK_GATEWAY_PORT || 3001);
  const gateway = createWebhookGateway(Number(process.env.PORT || 3000));
  gateway.requestTimeout = 20000;
  gateway.listen(port, '127.0.0.1', () => console.log(`Webhook únicamente: http://127.0.0.1:${port}/webhook`));
  process.on('SIGTERM', () => gateway.close());
}
