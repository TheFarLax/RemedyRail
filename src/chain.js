import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {TransactionHashVariant} from 'genlayer-js/types';
import {decodeEventLog, toEventSelector} from 'viem';

const client = createClient({chain: studionet});
const RPC = 'https://studio.genlayer.com/api';
export const EXPLORER = 'https://explorer-studio.genlayer.com';
export const ADDRESS = /^0x[a-f0-9]{40}$/i;
const HASH = /^0x[a-f0-9]{64}$/i;
const CHAIN_ID = '0xf22f';
const PAGE_SIZE = 12;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const newTransaction = studionet.consensusMainContract.abi.find(
  ({type, name}) => type === 'event' && name === 'NewTransaction',
);

export function wallet() {
  const provider = globalThis.ethereum;
  if (!provider?.request) throw new Error('Open the app in an EIP-1193 wallet browser, such as MetaMask.');
  return provider;
}

export async function connectWallet() {
  const address = (await wallet().request({method: 'eth_requestAccounts'}))[0];
  if (!ADDRESS.test(address)) throw new Error('The wallet did not provide an account.');
  return address;
}

async function switchNetwork(provider) {
  if ((await provider.request({method: 'eth_chainId'})).toLowerCase() === CHAIN_ID) return;
  try {
    await provider.request({method: 'wallet_switchEthereumChain', params: [{chainId: CHAIN_ID}]});
  } catch (error) {
    if (Number(error.code ?? error.data?.originalError?.code) !== 4902) throw error;
    await provider.request({method: 'wallet_addEthereumChain', params: [{
      chainId: CHAIN_ID, chainName: 'GenLayer Studionet', rpcUrls: [RPC],
      nativeCurrency: {name: 'GenLayer Test GEN', symbol: 'GEN', decimals: 18},
      blockExplorerUrls: [EXPLORER],
    }]});
    if ((await provider.request({method: 'eth_chainId'})).toLowerCase() !== CHAIN_ID) {
      await provider.request({method: 'wallet_switchEthereumChain', params: [{chainId: CHAIN_ID}]});
    }
  }
  if ((await provider.request({method: 'eth_chainId'})).toLowerCase() !== CHAIN_ID) {
    throw new Error('Switch the wallet to GenLayer Studionet.');
  }
}

export async function sign(provider, account, address, method, args) {
  await switchNetwork(provider);
  const selected = (await provider.request({method: 'eth_accounts'}))[0];
  if (selected?.toLowerCase() !== account.toLowerCase()) throw new Error('The selected wallet account changed.');
  const sdk = createClient({chain: studionet, provider, account});
  return sdk.writeContract({address, functionName: method, args, value: 0n, leaderOnly: false});
}

let rpcId = 0;
export async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, signal: AbortSignal.timeout(18_000),
    body: JSON.stringify({jsonrpc: '2.0', id: ++rpcId, method, params}),
  });
  if (!response.ok) throw new Error(`Studionet returned HTTP ${response.status}.`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

function consensusHash(receipt) {
  if (!newTransaction) return null;
  const topic = toEventSelector(newTransaction);
  for (const log of receipt?.logs ?? []) {
    if (log.topics[0] !== topic) continue;
    const decoded = decodeEventLog({abi: [newTransaction], data: log.data, topics: log.topics});
    if (HASH.test(decoded.args?.txId)) return decoded.args.txId;
  }
  return null;
}

export function executionError(receipt) {
  const raw = receipt?.consensus_data?.leader_receipt;
  const leader = Array.isArray(raw) ? raw.at(-1) : raw;
  if (leader?.execution_result === 'SUCCESS') return '';
  const vm = leader?.genvm_result;
  if (vm?.error_code === 'CONSENSUS_VALIDATOR_QUORUM_REACHED' &&
      ['MAJORITY_AGREE', 'UNANIMOUS_AGREE'].includes(receipt?.result_name)) return '';
  return vm?.error_description || vm?.error_code || 'GenVM reported an unsuccessful execution.';
}

export async function waitFinal(transaction, onStatus, timeout = 210_000) {
  if (!HASH.test(transaction.hash)) throw new Error('Invalid wallet transaction hash.');
  let hash = transaction.consensus_hash || transaction.hash;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    let state;
    try {
      state = await rpc('eth_getTransactionByHash', [hash]);
      if (!state || typeof state.status !== 'string' || state.status.startsWith('0x')) {
        const receipt = await rpc('eth_getTransactionReceipt', [transaction.hash]);
        if (receipt?.status === '0x0') return {hash, status: 'REVERTED', error: 'The wallet transaction reverted.'};
        const id = consensusHash(receipt);
        if (id) {
          hash = id;
          state = await rpc('eth_getTransactionByHash', [hash]);
        }
      }
    } catch {
      onStatus?.('Checking RPC', hash);
      await sleep(3200);
      continue;
    }
    const status = state?.status || 'SUBMITTED';
    onStatus?.(status, hash);
    if (status === 'FINALIZED') return {hash, status, error: executionError(state)};
    if (['CANCELED', 'CANCELLED'].includes(status)) return {hash, status, error: 'Studionet canceled this transaction.'};
    await sleep(3200);
  }
  throw new Error('The transaction is still pending. Use Check status to resume.');
}

export class StudioDesk {
  constructor(address) {
    if (!ADDRESS.test(address) || /^0x0{40}$/i.test(address)) throw new Error('Enter a valid RemedyRail contract address.');
    this.address = address;
    this.agreements = [];
    this.cases = {};
    this.more = false;
  }

  async read(functionName, ...args) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Studionet did not respond. Try refreshing.')), 24_000);
    });
    try {
      const raw = await Promise.race([timeout, client.readContract({
        address: this.address, functionName, args, transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
      })]);
      return JSON.parse(raw);
    } finally {
      clearTimeout(timer);
    }
  }

  async start() {
    const policy = await this.read('get_policy');
    if (policy?.name !== 'RemedyRail' || policy.version !== '1.0.0') throw new Error('This is not a compatible RemedyRail contract.');
    await this.loadPage(0);
  }

  async loadPage(offset) {
    const ids = await this.read('list_agreements', offset, PAGE_SIZE);
    const rows = await Promise.all(ids.map((id) => this.read('get_agreement', id)));
    this.agreements = [...this.agreements.slice(0, offset), ...rows];
    this.more = ids.length === PAGE_SIZE;
  }

  async refresh(id) {
    const agreement = await this.read('get_agreement', id);
    const cases = await Promise.all(agreement.case_ids.map((cid) => this.read('get_case', cid)));
    const index = this.agreements.findIndex((row) => row.id === id);
    if (index === -1) this.agreements.push(agreement);
    else this.agreements[index] = agreement;
    cases.forEach((record) => { this.cases[record.id] = record; });
  }

  get now() { return Math.floor(Date.now() / 60_000); }
  getCase(id) { return this.cases[id]; }
  getAgreement(id) { return this.agreements.find((row) => row.id === id); }
}
