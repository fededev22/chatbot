import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRecipientResolver} from '../whatsapp.mjs';

test('responde con el alias exacto verificado y conserva otros destinatarios', () => {
  const resolve=createRecipientResolver('{"5491100000000":"54111500000000"}');
  assert.equal(resolve('5491100000000'),'54111500000000');
  assert.equal(resolve('5491100000001'),'5491100000001');
  assert.equal(createRecipientResolver()('5491100000000'),'5491100000000');
});
test('rechaza alias corruptos y destinatarios no numéricos', () => {
  for (const raw of ['null','[]','malformado','{"5491100000000":123}','{"__proto__":"54111500000000"}','{"5491100000000":"https://example.com"}']) {
    assert.throws(()=>createRecipientResolver(raw));
  }
  assert.throws(()=>createRecipientResolver()('wa:5491100000000'));
});
