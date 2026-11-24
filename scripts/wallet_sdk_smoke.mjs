// Exercise a Studionet write through the app's EIP-1193 signing adapter.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {privateKeyToAccount} from 'viem/accounts';
import {rpc, sign, StudioDesk, waitFinal, EXPLORER} from '../src/chain.js';

const [contract, customer, monitor, output] = process.argv.slice(2);
const key = process.env.REMEDYRAIL_STUDIONET_TEST_KEY;
if (!contract || !customer || !monitor || !output || !key) {
  throw new Error('Pass contract, customer, monitor and output path plus a disposable Studionet key in REMEDYRAIL_STUDIONET_TEST_KEY.');
}
const account = privateKeyToAccount(key.startsWith('0x') ? key : '0x' + key);
const methods = [];
const provider = {
  request: async ({method, params = []}) => {
    methods.push(method);
    if (['eth_accounts','eth_requestAccounts'].includes(method)) return [account.address];
    if (method === 'eth_chainId') return rpc(method, []);
    if (method !== 'eth_sendTransaction') throw new Error('Unexpected provider method ' + method);
    const [tx] = params;
    assert.equal(Number(tx.chainId), 61999);
    assert.equal(BigInt(tx.value || 0), 0n);
    const signed = await account.signTransaction({
      to:tx.to, data:tx.data, gas:BigInt(tx.gas), gasPrice:BigInt(tx.gasPrice),
      nonce:Number(tx.nonce), chainId:61999, type:'legacy', value:0n,
    });
    return rpc('eth_sendRawTransaction', [signed]);
  },
};
const now = Math.floor(Date.now() / 60_000);
const id = 'wallet-smoke-' + crypto.randomUUID().slice(0,8);
const terms = {
  title:'Studionet wallet integration', service:'Synthetic probe', region:'Test region', provider:account.address,
  customer, monitor, invoice_line:id.toUpperCase(), currency:'USD', invoice_minor:10000,
  period_start:now - 1440, period_end:now + 1440, file_by:now + 2880,
  collect_minutes:10, challenge_minutes:10, bands:[[15,500],[30,1000]],
};
const hash = await sign(provider, account.address, contract, 'propose_agreement', [id, JSON.stringify(terms)]);
writeFileSync(output, JSON.stringify({contract, wallet:account.address, agreement_id:id, submitted_hash:hash, status:'SUBMITTED'}, null, 2) + '\n');
let prior;
const receipt = await waitFinal({hash}, (status, tx) => {
  if (prior !== status) console.log(status, tx);
  prior = status;
});
assert.equal(receipt.error, '');
assert.equal(receipt.status, 'FINALIZED');
const fromChain = await new StudioDesk(contract).read('get_agreement', id);
assert.equal(fromChain.terms.provider, account.address.toLowerCase());
assert.equal(fromChain.terms.invoice_line, terms.invoice_line);
assert(methods.includes('eth_sendTransaction'));
writeFileSync(output, JSON.stringify({status:'PASSED', contract, agreement_id:id, wallet:account.address, submitted_hash:hash,
  finalized_hash:receipt.hash, explorer_url:`${EXPLORER}/tx/${receipt.hash}`, provider_methods:methods,
  scope:'Scripted EIP-1193 signer using a disposable Studionet key.'}, null, 2) + '\n');
console.log('Wallet-backed write and finalized read verified.');
