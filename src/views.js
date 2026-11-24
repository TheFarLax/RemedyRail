import {
  Activity, ArrowDownToLine, BadgeCheck, Banknote, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp,
  Clock3, Database, FileCheck2, FileText, Gavel, GitPullRequestArrow, Globe2, Layers3, ListFilter, Menu,
  Plus, RadioTower, RefreshCw, Search, ShieldCheck, Timer, Upload, UserRound, WalletCards, X, createElement,
} from 'lucide';
import {allowedActions, projectCredit, ROLES, sumMinutes} from './model.js';
const EXPLORER = 'https://explorer-studio.genlayer.com';

const ICONS = {Activity, ArrowDownToLine, BadgeCheck, Banknote, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp,
  Clock3, Database, FileCheck2, FileText, Gavel, GitPullRequestArrow, Globe2, Layers3, ListFilter, Menu,
  Plus, RadioTower, RefreshCw, Search, ShieldCheck, Timer, Upload, UserRound, WalletCards, X};
export const icon = (name, cls = '') =>
  createElement(ICONS[name], {'aria-hidden': 'true', class: `icon ${cls}`, 'stroke-width': '1.75'}).outerHTML;

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) =>
  ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[char]);
export const titleCase = (text) => text.charAt(0).toUpperCase() + text.slice(1);
export const short = (hash, length = 9) => String(hash).slice(0, length) + '…' + String(hash).slice(-5);
const dateFormat = new Intl.DateTimeFormat('en-GB', {day:'numeric', month:'short', timeZone:'UTC'});
const timeFormat = new Intl.DateTimeFormat('en-GB', {hour:'2-digit', minute:'2-digit', timeZone:'UTC', hourCycle:'h23'});
const calendar = (minute) => dateFormat.format(new Date(minute * 60_000));
const clock = (minute) => timeFormat.format(new Date(minute * 60_000));
export const dateTime = (minute) => `${calendar(minute)} · ${clock(minute)} UTC`;
const span = (start, end) => calendar(start) === calendar(end) ?
  `${calendar(start)} · ${clock(start)}–${clock(end)} UTC` : `${dateTime(start)} – ${dateTime(end)}`;
const percent = (bps) => `${Number((bps / 100).toFixed(2))}%`;

export function money(amount, currency) {
  const format = new Intl.NumberFormat('en-US', {style:'currency', currency});
  return format.format(amount / 10 ** format.resolvedOptions().maximumFractionDigits);
}

export function button(label, action, {symbol = '', kind = '', disabled = false, value = ''} = {}) {
  return `<button type="button" class="button ${kind}" data-action="${action}" ${value ? `data-value="${esc(value)}"` : ''} ${disabled ? 'disabled' : ''}>
    ${symbol ? icon(symbol) : ''}<span>${esc(label)}</span></button>`;
}

const badges = {
  collecting: ['Collecting', 'slate'], appeal_collecting: ['Challenged', 'amber'], provisional: ['Provisional', 'blue'],
  reviewed: ['Ready', 'blue'], finalized: ['Settled', 'teal'], acknowledged: ['Acknowledged', 'teal'],
  applied: ['Applied', 'blue'], issued: ['Memo issued', 'blue'], SUPPORTED: ['Supported', 'teal'],
  PARTIAL: ['Partially supported', 'teal'], DENIED: ['Denied', 'slate'], INCONCLUSIVE: ['Inconclusive', 'amber'],
  OUTAGE: ['Outage', 'blue'], AVAILABLE: ['Available', 'amber'], UNCLEAR: ['Unclear', 'slate'], pending: ['Pending review', 'slate'],
  active: ['Active', 'teal'], draft: ['Awaiting approval', 'amber'],
};

export function chip(key) {
  const [label, color] = badges[key] || [key, 'slate'];
  return `<span class="chip chip-${color}"><i aria-hidden="true"></i>${esc(label)}</span>`;
}

const digestButton = (hash, label = 'Copy SHA-256 digest') =>
  `<button class="digest" type="button" data-action="copy" data-value="${esc(hash)}" title="${label}" aria-label="${label} ${esc(hash)}">${esc(short(hash, 10))}</button>`;

function nav(state, mobile = false) {
  const links = [['desk', 'Case desk', 'Layers3'], ['agreements', 'Agreements', 'BookOpen'], ['ledger', 'Credit ledger', 'Banknote']];
  return `<nav class="${mobile ? 'mobile-nav' : 'main-nav'}" aria-label="Workspace">${links.map(([key, label, symbol]) =>
    `<button data-action="nav" data-value="${key}" class="${state.page === key ? 'active' : ''}" ${state.page === key ? 'aria-current="page"' : ''}>
      ${icon(symbol)}<span>${label}</span></button>`).join('')}</nav>`;
}

function sidebar(state) {
  return `<aside class="sidebar">
    <div class="brand"><div class="brand-mark">${icon('GitPullRequestArrow')}</div><div><b>RemedyRail</b><span>SLA OPERATIONS</span></div></div>
    <div class="rail-label">WORKSPACE</div>
    ${nav(state)}
    <div class="side-foot">
      ${button('How it works', 'help', {symbol: 'CircleHelp', kind: 'side-help'})}
      <div class="network-foot"><div class="network-logo">${icon('Layers3')}</div>
        <div><strong>GenLayer</strong><span>${state.mode === 'live' ? 'Studionet · 61999' : 'SLA adjudication'}</span></div></div>
    </div>
  </aside>`;
}

function toolbar(state, role) {
  const page = {desk:'Case desk', agreements:'Agreements', ledger:'Credit ledger'}[state.page];
  const live = state.mode === 'live';
  const pane = live ? button(state.account ? short(state.account, 6) : 'Connect wallet', 'wallet', {symbol:'WalletCards', disabled:state.busy}) :
    `<label class="role-select">${icon('UserRound')}<span class="sr-only">Demo role</span>
    <select id="role-picker" aria-label="Demo role">${ROLES.map((name) => `<option value="${name}" ${role === name ? 'selected' : ''}>${titleCase(name)}</option>`).join('')}</select>${icon('ChevronDown')}</label>`;
  return `<header class="toolbar">
    <div class="crumb"><span class="mobile-brand"><i class="brand-mark">${icon('GitPullRequestArrow')}</i>RemedyRail</span>
      <span class="crumb-root">Workspace</span>${icon('ChevronRight')}<b>${page}</b></div>
    <div class="toolbar-actions">
      <button class="environment ${live ? 'live' : ''}" type="button" data-action="workspace" ${state.busy ? 'disabled' : ''}>
        <i></i>${live ? 'Studionet' : 'Demo data'}${icon('ChevronDown')}
      </button>${pane}
    </div>
  </header>${nav(state, true)}`;
}

function summary(agreement, records) {
  const open = records.filter((record) => record.stage !== 'finalized').length;
  const memos = records.filter((record) => record.settlement?.credit_minor > 0);
  const received = memos.filter((record) => record.application?.acknowledged_at != null);
  const recognized = received.reduce((value, record) => value + record.settlement.credit_minor, 0);
  const {terms, ledger} = agreement;
  const cards = [
    ['Open cases', open, 'Layers3', 'ink', `${records.length} filed this billing cycle`],
    ['Qualified downtime', `${ledger.total_minutes} min`, 'Timer', 'blue', 'Unique minutes after settlement'],
    ['Issued credits', money(ledger.credit_minor, terms.currency), 'Banknote', 'teal', `${memos.length} credit ${memos.length === 1 ? 'memo' : 'memos'} issued`],
    ['Acknowledged', money(recognized, terms.currency), 'FileCheck2', 'plum', `${received.length} confirmed by customer`],
  ];
  return `<section class="summary" aria-label="Agreement metrics">${cards.map(([label, value, symbol, hue, note]) =>
    `<article class="stat"><div class="stat-top"><span>${label}</span><i class="stat-icon ${hue}">${icon(symbol)}</i></div>
      <strong>${esc(value)}</strong><div>${note}</div></article>`).join('')}</section>`;
}

function agreementBar(agreement) {
  const {terms} = agreement;
  return `<div class="agreement-bar">
    <div class="agreement-symbol">${icon('ShieldCheck')}</div>
    <div class="bar-main"><strong>${esc(terms.title)}</strong>
      <span>${esc(terms.service)} <i></i> ${esc(terms.region)} <i></i> ${calendar(terms.period_start)}–${calendar(terms.period_end - 1)}</span></div>
    <div class="bar-invoice"><span>Invoice line</span><b>${esc(terms.invoice_line)}</b></div>
    <button type="button" class="bar-button" data-action="nav" data-value="agreements">View terms${icon('ChevronRight')}</button>
  </div>`;
}

function queue(records, state) {
  const count = records.filter((record) => record.stage !== 'finalized').length;
  const search = state.query.toLowerCase().trim();
  const ordered = [...records].sort((a, b) => {
    const current = Number(b.stage !== 'finalized') - Number(a.stage !== 'finalized');
    return current || b.filed_at - a.filed_at || a.id.localeCompare(b.id);
  });
  const rows = ordered.filter((record) => {
    const matches = `${record.title} ${record.id}`.toLowerCase().includes(search);
    return matches && (state.filter === 'all' || (state.filter === 'open') === (record.stage !== 'finalized'));
  });
  return `<section class="panel queue" aria-label="Incident queue">
    <header class="panel-heading"><div><h2>Case queue</h2><span>${count} open · ${records.length} total</span></div>${icon('ListFilter')}</header>
    <div class="queue-controls"><label class="search">${icon('Search')}<input id="queue-search" type="search" placeholder="Search cases" aria-label="Search cases" value="${esc(state.query)}"></label>
      <div class="filters" aria-label="Case status filter">${[['all','All'],['open','Open'],['closed','Settled']].map(([key, label]) =>
        `<button type="button" class="${state.filter === key ? 'active' : ''}" aria-pressed="${state.filter === key}" data-action="filter" data-value="${key}">${label}</button>`).join('')}</div>
    </div>
    <div class="queue-rows">${rows.map((record) => `<button type="button" data-action="select-case" data-value="${esc(record.id)}"
      class="case-row ${state.caseId === record.id ? 'chosen' : ''}" aria-pressed="${state.caseId === record.id}">
      <span class="row-ident"><span>${esc(record.id.toUpperCase())}</span>${chip(record.stage)}</span>
      <strong>${esc(record.title)}</strong><span class="row-date">${calendar(record.start)} · ${record.end - record.start} min claimed</span>
    </button>`).join('') || '<div class="empty-compact">No cases match this view.</div>'}</div>
  </section>`;
}

function workflow(record) {
  const current = record.stage === 'finalized' ? 3 : record.stage === 'reviewed' ? 2 :
    record.stage === 'provisional' || record.stage === 'appeal_collecting' ? 1 : 0;
  const steps = ['Filed', 'Reviewed', 'Ready', 'Settled'];
  return `<div class="stepper" aria-label="Case progress">${steps.map((label, i) =>
    `<div class="step ${i <= current ? 'done' : ''}" ${i === current ? 'aria-current="step"' : ''}><span>${i <= current ? icon('Check') : ''}</span>${label}</div>`).join('')}</div>`;
}

function bars(record, entries) {
  const width = record.end - record.start;
  return entries.map(([start, end, variant, text]) => {
    const left = Math.max(0, (start - record.start) * 100 / width);
    const length = Math.min(100 - left, (end - start) * 100 / width);
    return `<span class="track-bar ${variant}" style="--x:${left}%;--w:${length}%" title="${esc(text)}" role="img" aria-label="${esc(text)}"></span>`;
  }).join('');
}

function timeline(record) {
  const result = record.findings.at(-1);
  const labelMap = Object.fromEntries((result?.labels ?? []).map(({id, status}) => [id, status]));
  const classes = {OUTAGE:'observed', AVAILABLE:'availability', UNCLEAR:'unclear'};
  const lane = (label, entries, secondary = '') => `<div class="lane"><span>${label}${secondary ? `<small>${secondary}</small>` : ''}</span>
    <div class="track">${bars(record, entries)}</div></div>`;
  const windows = record.end - record.start >= 8 ? 4 : 2;
  const ticks = Array.from({length: windows + 1}, (_, i) => Math.round(record.start + (record.end - record.start) * i / windows));
  return `<div class="timeline">
    <div class="section-heading"><div><h3>Coverage timeline</h3><p>Attested windows and the latest finding.</p></div><span class="time-tag">UTC</span></div>
    <div class="timeline-plot">
      <div class="axis"><span></span><div>${ticks.map((point) => `<time>${clock(point)}</time>`).join('')}</div></div>
      ${lane('Claimed', [[record.start, record.end, 'claimed', span(record.start, record.end)]], `${record.end - record.start}m`)}
      ${['customer','provider','monitor'].map((role) => lane(titleCase(role), record.evidence.filter((item) => item.role === role)
        .sort((a,b) => a.round - b.round).map((item) => [item.start, item.end, classes[labelMap[item.id]] || 'unclear',
          `${titleCase(role)} · round ${item.round} · ${labelMap[item.id] || 'pending'} · ${span(item.start, item.end)}`]))).join('')}
      ${lane('Eligible', [
        ...(result?.eligible ?? []).map(([start,end]) => [start,end,'eligible',`Eligible · ${span(start,end)}`]),
        ...(result?.conflicts ?? []).map(([start,end]) => [start,end,'conflict',`Conflicting evidence · ${span(start,end)}`]),
      ], result ? `${result.eligible_minutes}m` : '')}
    </div>
    <div class="legend"><span><i class="key observed"></i>Outage attested</span><span><i class="key availability"></i>Availability attested</span>
      <span><i class="key eligible"></i>Eligible</span><span><i class="key conflict"></i>Disputed</span></div>
  </div>`;
}

function overview(record, agreement) {
  const result = record.findings.at(-1);
  const quote = record.settlement || (result && projectCredit(agreement, result.eligible));
  const settleLabel = record.settlement ? 'Credit memo' : 'Estimated credit';
  return `${timeline(record)}<div class="detail-grid">
    <div class="detail-stat"><span>Claimed outage</span><b>${record.end - record.start} min</b></div>
    <div class="detail-stat"><span>Eligible downtime</span><b>${result ? result.eligible_minutes + ' min' : '—'}</b></div>
    <div class="detail-stat"><span>${settleLabel}</span><b>${quote ? esc(money(quote.credit_minor, agreement.terms.currency)) : '—'}</b></div>
  </div>`;
}

function evidenceView(record) {
  const latest = record.findings.at(-1);
  if (!record.evidence.length) return '<div class="empty-compact">Waiting for the participant attestations.</div>';
  return `<div class="inner-list">
    ${[1, 2].filter((n) => record.evidence.some((item) => item.round === n)).map((n) => `<div class="round-group"><h3>${n === 1 ? 'Initial evidence' : 'Challenge evidence'}</h3>
    ${record.evidence.filter((item) => item.round === n).map((item) => {
      const row = latest?.labels.find((label) => label.id === item.id);
      const reference = /^https:\/\/[A-Za-z0-9]/.test(item.reference) ?
        `<a class="text-link" href="${esc(item.reference)}" target="_blank" rel="noopener noreferrer">Source reference</a>` : '';
      return `<article class="evidence-card"><div class="event-head"><strong>${titleCase(item.role)}</strong>${chip(row?.status || 'pending')}</div>
        <span class="event-meta">${span(item.start,item.end)} · ${esc(short(item.author, 8))}</span>
        <p>${esc(item.body)}</p>${row?.quote && row.quote !== item.body ? `<blockquote>${esc(row.quote)}</blockquote>` : ''}
        <div class="event-actions">${digestButton(item.hash)}${reference}</div>
      </article>`;
    }).join('')}</div>`).join('')}
  </div>`;
}

function historyView(record, live) {
  if (!record.findings.length) return '<div class="empty-compact">The initial finding will appear after review.</div>';
  return `<div class="inner-list history">
    <p class="history-guide">${live ? 'Findings read from finalized GenLayer state.' : 'Demo findings use preset labels and the same coverage rules.'}</p>
    ${record.findings.map((row, index) => `<div>
      ${index && record.challenge ? `<article class="challenge-record"><div class="round-icon">${icon('Gavel')}</div>
        <div><strong>Challenge filed by ${esc(record.challenge.role)}</strong><p>${esc(record.challenge.reason)}</p></div></article>` : ''}
      <article class="round-card"><div class="round-icon">${icon('FileCheck2')}</div><div class="round-copy">
      <div class="event-head"><strong>${index ? 'Appeal finding' : 'Initial finding'}</strong>${chip(row.verdict)}</div>
      <span class="event-meta">${dateTime(row.reviewed_at)} · ${row.labels.length} observations</span>
      <p><b>${row.eligible_minutes} min eligible</b>${row.conflicts.length ? ` · ${sumMinutes(row.conflicts)} min disputed` : ''}</p>
      <div class="event-actions">${digestButton(row.hash)}</div></div></article></div>`).join('')}
    ${record.challenge && record.findings.length === 1 ? `<article class="challenge-record"><div class="round-icon">${icon('Gavel')}</div>
      <div><strong>Challenge filed by ${esc(record.challenge.role)}</strong><p>${esc(record.challenge.reason)}</p></div></article>` : ''}
  </div>`;
}

function settlementView(record, agreement) {
  const {terms} = agreement;
  const settlement = record.settlement;
  const latest = record.findings.at(-1);
  if (!latest) return '<div class="empty-compact">A finding is needed before settlement can be calculated.</div>';
  const row = settlement || projectCredit(agreement, latest.eligible);
  const applied = record.application;
  const entries = [
    ['Invoice line', terms.invoice_line], ['Unique minutes added', `${sumMinutes(row.new_windows)} min`],
    ['Cumulative downtime', `${row.total_minutes} min`], ['Credit band', percent(row.band_bps)],
    ['Cumulative credit', money(row.cumulative_minor, terms.currency)],
  ];
  return `<div class="settlement-detail">
    <div class="memo-feature"><div><span>${settlement ? 'Credit memo amount' : 'Projected credit adjustment'}</span>
      <strong>${esc(money(row.credit_minor, terms.currency))}</strong></div>${icon('Banknote')}</div>
    <dl>${entries.map(([label,value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}
      ${settlement ? `<div><dt>Ledger digest</dt><dd>${digestButton(settlement.hash)}</dd></div>` : ''}
      ${applied ? `<div><dt>Application reference</dt><dd>${esc(applied.reference)}</dd></div>
      <div><dt>Customer acknowledgment</dt><dd>${applied.acknowledged_at != null ? esc(dateTime(applied.acknowledged_at)) : 'Pending'}</dd></div>` : ''}
    </dl>
    <p class="section-note">The memo records an invoice credit. Its application and acknowledgment are signed individually.</p>
  </div>`;
}

function caseDetail(record, agreement, state, role, now) {
  if (!record) return `<section class="panel detail empty-large" id="case-detail">${icon('Layers3')}<h2>Case detail</h2><p>Select or file a case to inspect its evidence.</p></section>`;
  const result = record.findings.at(-1);
  const active = allowedActions(agreement, record, role, now);
  const review = state.mode === 'live' ? 'Run GenLayer review' : 'Run demo review';
  const actions = [
    [active.attest, 'Attest evidence', 'attest', 'Plus', 'primary'],
    [active.review, review, 'review', 'Gavel', 'primary'],
    [active.challenge, 'Challenge finding', 'challenge', 'Gavel', ''],
    [active.finalize, 'Finalize settlement', 'finalize', 'BadgeCheck', 'primary'],
    [active.application, 'Record application', 'apply', 'FileCheck2', 'primary'],
    [active.acknowledge, 'Acknowledge credit', 'acknowledge', 'Check', 'primary'],
  ].filter(([visible]) => visible);
  const window = ['collecting','appeal_collecting'].includes(record.stage) ? record.collect_until :
    record.stage === 'provisional' ? record.challenge_until : null;
  const deadline = window !== null ? window > now ? `${window - now} min left · ${clock(window)} UTC` : 'Window closed' : '';
  const canAdvance = state.mode === 'demo' && window !== null && now < window && !active.review;
  const route = {overview: () => overview(record, agreement), evidence: () => evidenceView(record),
    history: () => historyView(record, state.mode === 'live'), settlement: () => settlementView(record, agreement)};
  return `<section class="panel detail" id="case-detail" aria-label="Case details">
    <div class="case-header">
      <div class="case-header-line"><span class="case-id">${esc(record.id.toUpperCase())}</span>
      <div>${chip(record.stage)}${result ? chip(result.verdict) : ''}</div></div>
      <h2>${esc(record.title)}</h2>
      <div class="case-meta">${icon('Clock3')}${span(record.start, record.end)}<span></span>${esc(agreement.terms.region)}</div>
      ${workflow(record)}
    </div>
    <div class="detail-tabs" aria-label="Case detail section">
      ${[['overview','Overview'],['evidence','Evidence'],['history','Decision history'],['settlement','Settlement']].map(([key,label]) =>
        `<button type="button" data-action="case-tab" data-value="${key}" aria-pressed="${state.tab === key}" class="${state.tab === key ? 'active' : ''}">${label}${key === 'evidence' ? `<i>${record.evidence.length}</i>` : ''}</button>`).join('')}
    </div>
    <div class="detail-content">${route[state.tab]()}</div>
    <footer class="case-actions">
      <span>${deadline ? `${icon('Clock3')}${deadline}` : record.settlement ? `${icon('BadgeCheck')}Finalized ${dateTime(record.settlement.finalized_at)}` : ''}</span>
      <div>${canAdvance ? button('Advance demo clock', 'advance', {symbol:'Timer', value:window, disabled:state.busy}) : ''}
      ${actions.map(([,label,action,symbol,kind]) => button(label, action, {symbol, kind, disabled:state.busy})).join('')}</div>
    </footer>
  </section>`;
}

function agreementsView(state, agreement, role) {
  const options = state.desk.agreements;
  return `<div class="split-grid">
    <section class="panel"><header class="panel-heading"><div><h2>Agreement registry</h2><span>${options.length} loaded</span></div>${icon('BookOpen')}</header>
    <div class="agreement-list">${options.map((entry) =>
      `<button type="button" class="case-row ${entry.id === state.agreementId ? 'chosen' : ''}" data-action="select-agreement"
        data-value="${esc(entry.id)}" aria-pressed="${entry.id === state.agreementId}">
        <span class="row-ident"><span>${esc(entry.terms.invoice_line)}</span>${chip(entry.activated_at !== null ? 'active' : 'draft')}</span>
        <strong>${esc(entry.terms.title)}</strong><span class="row-date">${esc(entry.terms.service)} · ${esc(entry.terms.region)}</span>
      </button>`).join('') || '<p class="empty-compact">No agreements have been proposed.</p>'}</div>
    ${state.desk.more ? `<div class="panel-padding">${button('Load more', 'more', {disabled:state.busy})}</div>` : ''}
    </section>${agreement ? policyCard(agreement, role, state) : ''}</div>`;
}

function policyCard(agreement, role, state) {
  const {terms, ledger} = agreement;
  const eligible = ['customer','monitor'].includes(role) && !(role in agreement.approvals) && state.desk.now < terms.file_by;
  return `<section class="panel policy">
    <header class="panel-heading"><div><div class="case-id">${esc(agreement.id.toUpperCase())}</div>
      <h2>${esc(terms.title)}</h2><span>${esc(terms.service)} · ${esc(terms.region)}</span></div>${chip(agreement.activated_at !== null ? 'active' : 'draft')}</header>
    <div class="policy-body">
      <div class="policy-terms">${[
        ['Invoice line', terms.invoice_line],['Invoice subtotal', money(terms.invoice_minor, terms.currency)],
        ['Billing period', `${calendar(terms.period_start)}–${calendar(terms.period_end-1)}`],
        ['File by', dateTime(terms.file_by)],['Evidence window', `${terms.collect_minutes} min`],['Challenge window', `${terms.challenge_minutes} min`],
      ].map(([label,value]) => `<div><span>${label}</span><strong>${esc(value)}</strong></div>`).join('')}</div>
      <h3>Approvals</h3><div class="participants">${ROLES.map((roleName) => `<div><strong>${titleCase(roleName)}</strong>
        <span class="mono">${esc(short(terms[roleName], 8))}</span><small class="${roleName in agreement.approvals ? 'approved' : ''}">
        ${roleName in agreement.approvals ? 'Approved' : 'Pending'}</small></div>`).join('')}</div>
      <h3>Credit bands</h3><div class="credit-bands">${terms.bands.map(([min, bps]) => `<div class="${min <= ledger.total_minutes ? 'band-reached' : ''}">
        <span>${min}+ min</span><strong>${percent(bps)}</strong><small>${esc(money(Math.floor(terms.invoice_minor * bps / 10_000), terms.currency))}</small></div>`).join('')}</div>
      <div class="event-actions"><span class="muted">Terms digest</span>${digestButton(agreement.terms_hash)}
      ${eligible ? button('Approve terms', 'approve', {symbol:'Check', kind:'primary', disabled:state.busy}) : ''}</div>
    </div>
  </section>`;
}

function ledgerView(agreement, records, busy) {
  const {terms, ledger} = agreement;
  const rows = records.filter((r) => r.settlement).sort((a,b) => a.settlement.sequence - b.settlement.sequence);
  return `<section class="panel ledger">
    <header class="panel-heading"><div><h2>Settlement ledger</h2><span>${rows.length} finalized case ${rows.length === 1 ? 'entry' : 'entries'}</span></div>${icon('Database')}</header>
    <div class="ledger-body"><div class="ledger-track">
      <div><span>Ledger head</span>${digestButton(ledger.head)}</div>
      <div><span>Invoice line</span><b>${esc(terms.invoice_line)}</b></div>
      <div><span>Total credit</span><b>${esc(money(ledger.credit_minor, terms.currency))}</b></div>
    </div>
    <div class="table-scroll"><table><thead><tr><th>Case</th><th>New downtime</th><th>Credit band</th><th>Credit delta</th><th>Memo status</th></tr></thead>
      <tbody>${rows.map((record) => {
        const row = record.settlement;
        const status = row.credit_minor === 0 ? 'No adjustment' : record.application?.acknowledged_at != null ? 'acknowledged' :
          record.application ? 'applied' : 'issued';
        return `<tr><td><button class="table-link" data-action="ledger-case" data-value="${esc(record.id)}">${esc(record.title)}</button>
          <small>${esc(record.id.toUpperCase())} · ${dateTime(row.finalized_at)}</small></td>
          <td>${sumMinutes(row.new_windows)} min</td><td>${percent(row.band_bps)}</td><td><b>${esc(money(row.credit_minor, terms.currency))}</b></td><td>${chip(status)}</td></tr>`;
      }).join('') || '<tr><td colspan="5">No cases have settled yet.</td></tr>'}</tbody></table></div>
    <div class="ledger-actions">${button('Export audit bundle', 'export', {symbol:'ArrowDownToLine', disabled:busy})}
      ${button('Verify audit bundle', 'verify', {symbol:'Upload', disabled:busy})}</div></div>
  </section>`;
}

function pendingBar(state) {
  if (!state.pending) return '';
  const tx = state.pending;
  return `<aside class="tx-banner" aria-label="Pending transaction"><span>${icon('Activity')}<b>${esc(tx.status || 'Submitted')}</b>
    <a href="${EXPLORER}/tx/${esc(tx.consensus_hash || tx.hash)}" target="_blank" rel="noopener noreferrer">${esc(short(tx.consensus_hash || tx.hash))}</a></span>
    ${button('Check status', 'retry', {disabled:state.busy})}</aside>`;
}

function empty(state) {
  return `<section class="panel empty-large">${icon('BookOpen')}<h2>No agreement selected</h2>
  <p>Open the registry to select or propose an agreement.</p>${button('View agreements', 'nav', {value:'agreements'})}</section>`;
}

export function renderWorkspace(state) {
  const agreement = state.desk.getAgreement(state.agreementId);
  const records = agreement?.case_ids.map((id) => state.desk.getCase(id)).filter(Boolean) ?? [];
  const record = state.desk.getCase(state.caseId);
  const role = state.mode === 'demo' ? state.demoRole :
    ROLES.find((item) => agreement?.terms[item] === state.account?.toLowerCase() && state.account);
  const now = state.desk.now;
  const label = {desk:'SLA case desk', agreements:'Agreements', ledger:'Credit ledger'}[state.page];
  const sub = {desk:'Review incident evidence and reconcile service credits.', agreements:'Commit the invoice scope, participants and credit policy.',
    ledger:'Track credit memos and reproduce settlement calculations.'}[state.page];
  const canFile = role === 'customer' && agreement?.activated_at != null && now < agreement.terms.file_by;
  const headerAction = state.page === 'agreements' ? button('New agreement', 'propose', {symbol:'Plus', kind:'primary', disabled:state.busy}) :
    state.page === 'desk' && canFile ? button('File incident', 'file', {symbol:'Plus', kind:'primary', disabled:state.busy}) : '';
  const content = state.page === 'agreements' ? agreementsView(state, agreement, role) : !agreement ? empty(state) :
    state.page === 'ledger' ? `${agreementBar(agreement)}${ledgerView(agreement, records, state.busy)}` :
    `${summary(agreement, records)}${agreementBar(agreement)}
      <div class="split-grid">${queue(records, state)}${caseDetail(record, agreement, state, role, now)}</div>`;
  return `<div class="layout">${sidebar(state)}<div class="shell">${toolbar(state, role)}
    <main class="content" id="workspace">
      <div class="page-heading"><div><h1>${label}</h1><p>${sub}</p></div>
        <div class="heading-actions">${state.mode === 'live' ? `<a class="button explorer-button" href="${EXPLORER}/address/${esc(state.desk.address)}"
          target="_blank" rel="noopener noreferrer">${icon('Globe2')}<span>Explorer</span></a>
          ${button('Refresh', 'refresh', {symbol:'RefreshCw', disabled:state.busy})}` : '' }${headerAction}</div></div>
      ${pendingBar(state)}${content}
    </main></div></div>`;
}
