import '@fontsource/ibm-plex-mono/latin-400.css';
import './styles.css';
import deployment from './deployment.json';
import {DEMO_ACTORS, DemoDesk} from './demo.js';
import {DAY, minuteInput, parseMinute, verifyBundle} from './model.js';
import {button, dateTime, esc, icon, renderWorkspace, short} from './views.js';

const root = document.getElementById('app');
const sheet = document.getElementById('sheet');
const notice = document.getElementById('notice');
const PENDING = 'remedyrail-pending-v1';
const state = {
  mode:'demo', desk:null, demo:null, page:'desk', tab:'overview', query:'', filter:'all', demoRole:'customer',
  agreementId:'', caseId:'', account:'', busy:false, pending:null,
};

function render() {
  if (state.desk) root.innerHTML = renderWorkspace(state);
}

let toastTimer;
function toast(text, tone = 'normal') {
  notice.innerHTML = `<div class="toast ${tone}">${icon(tone === 'error' ? 'CircleHelp' : 'Check')}<span>${esc(text)}</span></div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { notice.innerHTML = ''; }, tone === 'error' ? 8000 : 4700);
}

function loadPending(address) {
  try {
    const tx = JSON.parse(localStorage.getItem(PENDING + ':' + address.toLowerCase()) || 'null');
    return tx?.address?.toLowerCase() === address.toLowerCase() && /^0x[a-f0-9]{64}$/i.test(tx.hash) ? tx : null;
  } catch { return null; }
}

function savePending(tx) {
  state.pending = tx;
  const key = PENDING + ':' + state.desk.address.toLowerCase();
  try {
    if (tx) localStorage.setItem(key, JSON.stringify(tx));
    else localStorage.removeItem(key);
  } catch {}
}

function selectCase(id) {
  state.caseId = id;
  state.tab = 'overview';
}

async function selectAgreement(id, preferredCase = '', refresh = true) {
  if (!id) {
    state.agreementId = '';
    selectCase('');
    return;
  }
  if (state.mode === 'live' && refresh) await state.desk.refresh(id);
  state.agreementId = id;
  const agreement = state.desk.getAgreement(id);
  selectCase(agreement.case_ids.includes(preferredCase) ? preferredCase : agreement.case_ids[0] || '');
  state.query = '';
  state.filter = 'all';
}

function openSheet(title, body) {
  sheet.innerHTML = `<div class="sheet-top"><h2 id="sheet-title">${esc(title)}</h2>
    <button type="button" class="icon-button" data-action="close" aria-label="Close dialog">${icon('X')}</button></div>${body}`;
  if (!sheet.open) sheet.showModal();
}

function dialogForm(kind, content, label) {
  return `<form data-form="${kind}">${content}<p class="form-error" role="alert" hidden></p>
    <footer class="sheet-actions">${button('Cancel','close')}<button type="submit" class="button primary"><span>${label}</span></button></footer></form>`;
}

function field(name, label, {value = '', type = 'text', attrs = '', optional = false, note = ''} = {}) {
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${optional ? '' : 'required'} ${attrs}>
    ${note ? `<small>${note}</small>` : ''}</label>`;
}

function area(name, label, max, note) {
  return `<label class="field"><span>${label}</span><textarea name="${name}" rows="4" maxlength="${max}" required></textarea>
    ${note ? `<small>${note}</small>` : ''}</label>`;
}

function formError(error) {
  if (!sheet.open || !sheet.querySelector('.form-error')) {
    toast(error.message || String(error), 'error');
    return;
  }
  const el = sheet.querySelector('.form-error');
  el.hidden = false;
  el.textContent = error.shortMessage || error.message || String(error);
}

function setBusy(busy) {
  state.busy = busy;
  const submit = sheet.querySelector('button[type="submit"]');
  if (submit) submit.disabled = busy;
  render();
}

function openWorkspace() {
  const live = state.mode === 'live';
  openSheet('Workspace connection', `<div class="workspace-modes">
    <section><div class="workspace-icon">${icon('Layers3')}</div><h3>Demo data</h3>
    <p>Explore sample cases, switch roles and try the challenge workflow in your browser.</p>
    ${button(live ? 'Switch to demo' : 'Demo is open', 'demo', {disabled:!live})}</section>
    <section><div class="workspace-icon">${icon('Globe2')}</div><h3>GenLayer Studionet</h3>
    <p>Read finalized cases without a wallet. Participant wallets sign changes.</p>
    ${deployment.contract_address ? button('Open live case', 'builtin-live', {kind:'primary'}) : ''}</section></div>
    ${dialogForm('live', field('address','RemedyRail contract address', {
      value:state.desk.address || deployment.contract_address, attrs:'pattern="0[xX][a-fA-F0-9]{40}" placeholder="0x…" autocomplete="off"',
    }), 'Open contract')}`);
}

function openFile(recordAgreement) {
  const {terms} = recordAgreement;
  const end = Math.min(state.desk.now, terms.period_end);
  const start = Math.max(terms.period_start, end - 30);
  openSheet('File an incident', dialogForm('file', `
    <p class="form-info">${esc(terms.service)} · ${esc(terms.region)} · ${esc(terms.invoice_line)}</p>
    ${field('title','Case title',{attrs:'maxlength="108" placeholder="e.g. API interruption" autofocus'})}
    <div class="form-grid">${field('start','Outage start (UTC)',{type:'datetime-local',value:minuteInput(start)})}
    ${field('end','Outage end (UTC)',{type:'datetime-local',value:minuteInput(end)})}</div>
    <p class="form-info">Use a completed window within the billing period. The filing deadline is ${dateTime(terms.file_by)}.</p>`, 'File case'));
}

function openEvidence(record, challenge) {
  const choices = state.mode === 'demo' ? `<label class="field"><span>Demo evidence label</span><select name="label">
    <option value="OUTAGE">Supports full outage</option><option value="AVAILABLE" ${challenge ? 'selected' : ''}>Supports availability</option>
    <option value="UNCLEAR">Unclear</option></select><small>Sets the sample result used in demo review.</small></label>` : '';
  openSheet(challenge ? 'Challenge finding' : 'Attest evidence', dialogForm(challenge ? 'challenge' : 'attest', `
    ${challenge ? area('reason','Reason for challenge',420,'Include a new observation that supports the correction.') : ''}
    <div class="form-grid">
      ${field('start','Observed start (UTC)',{type:'datetime-local',value:minuteInput(record.start)})}
      ${field('end','Observed end (UTC)',{type:'datetime-local',value:minuteInput(record.end)})}
    </div>
    ${area('body','Observation',1200,state.mode === 'live' ? 'This excerpt is public on Studionet. Include the service, region, UTC dates and availability.' : 'Describe what happened in this service and region during the selected window.')}
    ${field('reference','Source reference (optional)',{type:'url',optional:true,attrs:'maxlength="250" placeholder="https://"',note:'Attach a public URL for reviewers to open.'})}
    ${choices}`, challenge ? 'Submit challenge' : 'Attest observation'));
}

function openPropose() {
  const isDemo = state.mode === 'demo';
  if (isDemo && state.demoRole !== 'provider') {
    toast('Switch the demo role to Provider to propose an agreement.', 'error');
    return;
  }
  if (!isDemo && !state.account) {
    toast('Connect a wallet to propose an agreement.', 'error');
    return;
  }
  const now = state.desk.now;
  openSheet('Propose SLA terms', dialogForm('propose', `
    ${field('title','Agreement title',{attrs:'maxlength="96" placeholder="e.g. Atlas Cloud SLA"'})}
    <div class="form-grid">${field('service','Service',{attrs:'maxlength="64" placeholder="Atlas API"'})}
    ${field('region','Region',{attrs:'maxlength="48" placeholder="EU West"'})}
    ${field('invoice_line','Invoice line',{attrs:'maxlength="72" placeholder="INV-440-01"'})}
    ${field('currency','Currency',{value:'USD',attrs:'pattern="[A-Za-z]{3}" maxlength="3"'})}
    ${field('invoice_minor','Invoice amount (minor units)',{type:'number',value:400000,attrs:'min="1" max="100000000000"',note:'USD 4,000.00 is 400,000 cents.'})}
    ${field('id','Agreement ID',{value:'sla-' + crypto.randomUUID().slice(0,8),attrs:'maxlength="32"'})}
    ${field('period_start','Billing period start (UTC)',{type:'datetime-local',value:minuteInput(now - 7 * DAY)})}
    ${field('period_end','Billing period end (UTC)',{type:'datetime-local',value:minuteInput(now + 21 * DAY)})}
    ${field('file_by','Filing deadline (UTC)',{type:'datetime-local',value:minuteInput(now + 24 * DAY)})}
    ${field('collect_minutes','Evidence window (minutes)',{type:'number',value:45,attrs:'min="1" max="10080"'})}
    ${field('challenge_minutes','Challenge window (minutes)',{type:'number',value:45,attrs:'min="1" max="10080"'})}</div>
    ${field('bands','Credit bands (minutes:percent)',{value:'20:5, 60:10, 120:25',note:'Enter up to six increasing thresholds and percentages.'})}
    ${isDemo ? '<p class="form-info">This demo uses the existing three participant identities.</p>' :
    `${field('customer','Customer wallet',{attrs:'pattern="0x[a-fA-F0-9]{40}" placeholder="0x…"'})}
    ${field('monitor','Monitor wallet',{attrs:'pattern="0x[a-fA-F0-9]{40}" placeholder="0x…"'})}`}
    <p class="form-info">The customer and monitor must each approve the same terms digest before filing opens.</p>`, 'Propose agreement'));
}

async function openLive(address, initialAgreement, initialCase) {
  const {StudioDesk} = await import('./chain.js');
  const chain = new StudioDesk(address);
  await chain.start();
  const first = initialAgreement && chain.getAgreement(initialAgreement) ? initialAgreement : chain.agreements[0]?.id;
  if (first) await chain.refresh(first);
  state.desk = chain;
  state.mode = 'live';
  state.pending = loadPending(address);
  await selectAgreement(first || '', initialCase, false);
  state.page = first ? 'desk' : 'agreements';
  sheet.close();
  toast('Finalized Studionet state loaded.');
}

async function completePending() {
  if (!state.pending) return;
  const {waitFinal} = await import('./chain.js');
  const pending = state.pending;
  const result = await waitFinal(pending, (status, hash) => {
    if (pending.status !== status || pending.consensus_hash !== hash) {
      pending.status = status;
      pending.consensus_hash = hash;
      savePending(pending);
      render();
    }
  });
  savePending(null);
  if (result.error) throw new Error(result.error);
  try {
    await afterWrite(pending.method, pending.agreementId);
  } catch {
    toast('The transaction finalized. Use Refresh to load the latest state.');
    return;
  }
  toast('Transaction finalized on Studionet.');
}

async function afterWrite(method, agreementId, output) {
  if (state.mode === 'live') await state.desk.refresh(agreementId);
  if (method === 'propose_agreement') {
    state.agreementId = agreementId;
    state.page = 'agreements';
    selectCase('');
  } else if (method === 'file_case') {
    state.page = 'desk';
    selectCase(output || state.desk.getAgreement(agreementId).case_ids.at(-1));
  } else if (method === 'challenge_case' || method === 'review_case') state.tab = 'history';
  else if (['finalize_case','record_application','acknowledge_application'].includes(method)) state.tab = 'settlement';
  else if (method === 'attest') state.tab = 'evidence';
}

async function write(method, args, demoStatus = 'UNCLEAR') {
  const agreementId = method === 'propose_agreement' ? args[0] : state.agreementId;
  if (state.mode === 'demo') {
    const localResult = await state.desk.write(method, args, state.demoRole, demoStatus);
    sheet.close();
    await afterWrite(method, agreementId, localResult);
    toast('Demo workspace updated.');
    return;
  }
  if (state.pending) throw new Error('Check the pending transaction before submitting a new one.');
  const {connectWallet, sign, wallet} = await import('./chain.js');
  if (!state.account) state.account = await connectWallet();
  const address = state.desk.address;
  const hash = await sign(wallet(), state.account, address, method, args);
  savePending({hash, address, account:state.account, status:'Submitted', method, agreementId});
  sheet.close();
  render();
  await completePending();
}

function currentBundle() {
  const agreement = state.desk.getAgreement(state.agreementId);
  return {
    schema:'remedyrail-audit/v1', mode:state.mode, chain_id:state.mode === 'live' ? 61999 : null,
    contract:state.desk.address || null, agreement, cases:agreement.case_ids.map((id) => state.desk.getCase(id)),
  };
}

async function exportBundle() {
  const bundle = currentBundle();
  await verifyBundle(bundle);
  const file = new Blob([JSON.stringify(bundle, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = `remedyrail-${bundle.agreement.id}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Audit bundle exported and checked.');
}

const tasks = async (operation) => {
  if (state.busy) return;
  try {
    setBusy(true);
    await operation();
  } catch (error) {
    formError(error);
  } finally {
    setBusy(false);
  }
};

function scrollDetail() {
  if (matchMedia('(max-width: 800px)').matches) {
    document.getElementById('case-detail')?.scrollIntoView({behavior:'smooth', block:'start'});
  }
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const value = target.dataset.value;
  const agreement = state.desk.getAgreement(state.agreementId);
  const record = state.desk.getCase(state.caseId);
  const sync = {
    nav: () => { state.page = value; render(); window.scrollTo({top:0}); },
    'select-case': () => { selectCase(value); render(); scrollDetail(); },
    'ledger-case': () => { selectCase(value); state.tab = 'settlement'; state.page = 'desk'; render(); scrollDetail(); },
    'case-tab': () => { state.tab = value; render(); root.querySelector(`[data-action="case-tab"][data-value="${value}"]`)?.focus(); },
    filter: () => { state.filter = value; render(); },
    workspace: openWorkspace,
    close: () => sheet.close(),
    demo: () => { state.mode = 'demo'; state.desk = state.demo; state.pending = null; state.page = 'desk';
      selectAgreement(state.demo.agreements[0].id).then(render); sheet.close(); },
    file: () => openFile(agreement),
    attest: () => openEvidence(record, false),
    challenge: () => openEvidence(record, true),
    propose: openPropose,
    apply: () => openSheet('Record credit application', dialogForm('apply',
      field('reference','Credit note reference',{attrs:'maxlength="80" placeholder="CN-1048"'}), 'Record application')),
    advance: () => { state.desk.advance(Number(value)); render(); toast('Demo clock advanced to the window deadline.'); },
    verify: () => openSheet('Verify audit bundle', dialogForm('verify', `
      <p class="form-info">Recompute evidence hashes, findings and invoice credit math from a RemedyRail export.</p>
      <label class="field"><span>Audit bundle</span><input type="file" name="bundle" accept=".json,application/json" required></label>`, 'Verify bundle')),
    help: () => openSheet('How RemedyRail works', `<div class="help-list">
      <article><b>1. Approve the SLA</b><p>The provider, customer and independent monitor accept the same invoice and credit policy.</p></article>
      <article><b>2. Review signed evidence</b><p>A monitor and at least one billing party must corroborate a window. The challenge round preserves the first decision.</p></article>
      <article><b>3. Reconcile credit</b><p>The ledger counts each outage minute once. The provider records the credit note and the customer can acknowledge it.</p></article>
      </div><div class="sheet-actions">${button('Done','close',{kind:'primary'})}</div>`),
  }[action];
  if (sync) { sync(); return; }
  const asynchronous = {
    'builtin-live': () => openLive(deployment.contract_address, deployment.agreement_id, deployment.case_id),
    'select-agreement': () => selectAgreement(value),
    wallet: async () => {
      const {connectWallet} = await import('./chain.js');
      state.account = await connectWallet();
      toast('Wallet connected.');
    },
    refresh: async () => {
      if (state.agreementId) await state.desk.refresh(state.agreementId);
      else await state.desk.loadPage(0);
      toast('Finalized state refreshed.');
    },
    more: () => state.desk.loadPage(state.desk.agreements.length),
    export: exportBundle,
    copy: async () => { await navigator.clipboard.writeText(value); toast('Digest copied.'); },
    retry: completePending,
    review: () => write('review_case', [record.id]),
    approve: () => write('approve_agreement', [agreement.id, agreement.terms_hash]),
    finalize: () => write('finalize_case', [record.id]),
    acknowledge: () => write('acknowledge_application', [record.id]),
  }[action];
  if (asynchronous) void tasks(asynchronous);
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  const data = new FormData(form);
  const read = (name) => String(data.get(name) || '').trim();
  const interval = () => [parseMinute(read('start')), parseMinute(read('end'))];
  const evidence = () => [...interval(), read('body'), read('reference')];
  const plans = {
    live: () => openLive(read('address'), deployment.agreement_id, deployment.case_id),
    file: () => write('file_case', [state.agreementId, read('title'), ...interval()]),
    attest: () => write('attest', [state.caseId, ...evidence()], read('label')),
    challenge: () => write('challenge_case', [state.caseId, read('reason'), ...evidence()], read('label')),
    apply: () => write('record_application', [state.caseId, read('reference')]),
    propose: () => {
      const bands = read('bands').split(',').map((part) => {
        const row = /^\s*(\d+)\s*:\s*(\d+(?:\.\d{1,2})?)\s*$/.exec(part);
        if (!row) throw new Error('Use credit bands like 20:5, 60:10.');
        return [Number(row[1]), Math.round(Number(row[2]) * 100)];
      });
      const accounts = state.mode === 'demo' ? DEMO_ACTORS : {provider:state.account.toLowerCase(), customer:read('customer'), monitor:read('monitor')};
      const terms = {title:read('title'), service:read('service'), region:read('region'), ...accounts,
        invoice_line:read('invoice_line').toUpperCase(), currency:read('currency').toUpperCase(),
        invoice_minor:Number(read('invoice_minor')), period_start:parseMinute(read('period_start')),
        period_end:parseMinute(read('period_end')), file_by:parseMinute(read('file_by')),
        collect_minutes:Number(read('collect_minutes')), challenge_minutes:Number(read('challenge_minutes')), bands};
      return write('propose_agreement', [read('id'),JSON.stringify(terms)]);
    },
    verify: async () => {
      const item = data.get('bundle');
      if (!item || item.size > 2_000_000) throw new Error('Pick a RemedyRail JSON bundle under 2 MB.');
      const input = JSON.parse(await item.text());
      if (input.schema !== 'remedyrail-audit/v1') throw new Error('Unexpected audit bundle format.');
      const result = await verifyBundle(input);
      sheet.close();
      toast(`Verified ${result.cases} cases and ${result.settlements} settlements. Ledger ${short(result.head)}.`);
    },
  };
  const operation = plans[form.dataset.form];
  if (operation) void tasks(operation);
});

root.addEventListener('change', (event) => {
  if (event.target.id === 'role-picker') {
    state.demoRole = event.target.value;
    render();
    root.querySelector('#role-picker')?.focus();
  }
});

root.addEventListener('input', (event) => {
  if (event.target.id !== 'queue-search') return;
  state.query = event.target.value;
  render();
  const input = root.querySelector('#queue-search');
  input.focus();
  const end = input.value.length;
  try { input.setSelectionRange(end, end); } catch {}
});

globalThis.ethereum?.on?.('accountsChanged', ([account]) => {
  state.account = account || '';
  if (state.mode === 'live') render();
});

async function start() {
  root.innerHTML = '<div class="boot"><b>RemedyRail</b><p>Loading the case desk…</p></div>';
  state.demo = await DemoDesk.load();
  state.desk = state.demo;
  await selectAgreement(state.demo.agreements[0].id);
  render();
  if (new URLSearchParams(location.search).get('network') === 'studionet' && deployment.contract_address) {
    await tasks(() => openLive(deployment.contract_address, deployment.agreement_id, deployment.case_id));
  }
}

start().catch((error) => {
  root.innerHTML = '<div class="boot"><b>RemedyRail</b><p>The workspace could not be opened.</p></div>';
  toast(error.message, 'error');
});
