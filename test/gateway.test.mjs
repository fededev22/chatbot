import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createWebhookGateway} from '../webhook-gateway.mjs';

test('el puerto público reenvía el webhook intacto y rechaza acceso al panel', async t => {
  const observed = [];
  const origin = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    observed.push({path:req.url, method:req.method, body:Buffer.concat(chunks).toString(), signature:req.headers['x-hub-signature-256']});
    res.writeHead(200, {'Content-Type':'text/plain'});
    res.end('challenge-ok');
  });
  await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve));
  const gateway = createWebhookGateway(origin.address().port);
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  t.after(() => {gateway.closeAllConnections();gateway.close();origin.closeAllConnections();origin.close();});
  const base = `http://127.0.0.1:${gateway.address().port}`;
  for (const path of ['/', '/api/dashboard', '/app.js', '/webhook/../api/dashboard']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
  assert.equal((await fetch(base + '/webhook', {method:'PUT'})).status, 404);
  assert.equal(observed.length, 0);
  const challenge = await fetch(base + '/webhook?hub.challenge=abc&hub.mode=subscribe');
  assert.equal(await challenge.text(), 'challenge-ok');
  assert.equal(observed[0].path, '/webhook?hub.challenge=abc&hub.mode=subscribe');
  const raw = '{ "message": "hola", "unicode": "á" }';
  await fetch(base + '/webhook', {method:'POST', headers:{'x-hub-signature-256':'sha256=test', 'content-type':'application/json'}, body:raw});
  assert.equal(observed[1].body, raw);
  assert.equal(observed[1].signature, 'sha256=test');
  assert.equal((await fetch(base + '/webhook', {method:'POST',body:'x'.repeat(65537)})).status, 413);
  assert.equal(observed.length, 2);
});
