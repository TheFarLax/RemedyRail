import {allowedActions, computeFinding, DAY, digest, GENESIS, minuteInput, projectCredit, ROLES, toMinute} from './model.js';

const STORE = 'remedyrail-demo-v1';
const BASE = toMinute('2026-11-20T14:20:00Z');
export const DEMO_ACTORS = {
  provider: '0x1100000000000000000000000000000000000011',
  customer: '0x2200000000000000000000000000000000000022',
  monitor: '0x3300000000000000000000000000000000000033',
};
const require = (condition, text) => { if (!condition) throw new Error(text); };
const time = (text) => toMinute(`${text}Z`);

export class DemoDesk {
  constructor(data) {
    this.data = data;
  }

  static async load() {
    try {
      const stored = localStorage.getItem(STORE);
      if (stored) return new DemoDesk(JSON.parse(stored));
    } catch {}
    return seed();
  }

  save() {
    try { localStorage.setItem(STORE, JSON.stringify(this.data)); } catch {}
  }

  get now() { return this.data.now; }
  get agreements() { return Object.values(this.data.agreements); }
  getCase(id) { return this.data.cases[id]; }
  getAgreement(id) { return this.data.agreements[id]; }

  advance(minute) {
    this.data.now = Math.max(this.now, minute);
    this.save();
  }

  async write(method, args, role, demoStatus = 'UNCLEAR') {
    const [id, ...rest] = args;
    const before = structuredClone(this.data);
    try {
      if (method === 'propose_agreement') return await this.propose(id, JSON.parse(rest[0]), role);
      if (method === 'approve_agreement' || method === 'file_case') return await this.updateAgreement(method, id, rest, role);
      return await this.updateCase(method, id, rest, role, demoStatus);
    } catch (error) {
      this.data = before;
      throw error;
    } finally {
      this.save();
    }
  }

  async propose(id, terms, role) {
    require(role === 'provider', 'Switch to the provider role to propose an agreement.');
    require(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(id) && !this.getAgreement(id), 'Agreement ID is invalid or already in use.');
    for (const key of ['title', 'service', 'region']) require(terms[key]?.trim(), 'Title, service and region are required.');
    for (const key of ROLES) require(terms[key] === DEMO_ACTORS[key], 'Use the three demo wallet addresses.');
    require(terms.period_start < terms.period_end && terms.period_end - terms.period_start <= 31 * DAY, 'Use a billing period up to 31 days.');
    require(terms.file_by >= terms.period_end && terms.file_by <= terms.period_end + 7 * DAY && terms.file_by > this.now, 'Check the filing deadline.');
    require(Number.isSafeInteger(terms.invoice_minor) && terms.invoice_minor > 0 && terms.invoice_minor <= 1e11, 'Invoice amount is out of range.');
    require(/^[A-Z]{3}$/.test(terms.currency) && /^[A-Z0-9][A-Z0-9_-]{0,71}$/.test(terms.invoice_line), 'Check the currency and invoice line.');
    for (const key of ['collect_minutes', 'challenge_minutes']) {
      require(Number.isInteger(terms[key]) && terms[key] >= 1 && terms[key] <= 7 * DAY, 'Enter a window from 1 to 10,080 minutes.');
    }
    require(Array.isArray(terms.bands) && terms.bands.length >= 1 && terms.bands.length <= 6, 'Use one to six credit bands.');
    let prior = [0, 0];
    for (const [minutes, bps] of terms.bands) {
      require(Number.isInteger(minutes) && Number.isInteger(bps) &&
        minutes > prior[0] && minutes <= terms.period_end - terms.period_start && bps > prior[1] && bps <= 10_000,
      'Bands must increase in minutes and credit rate.');
      prior = [minutes, bps];
    }
    const hash = await digest(terms);
    this.data.agreements[id] = {
      id, terms, terms_hash: hash, created_at: this.now, approvals: {provider: this.now}, activated_at: null, case_ids: [],
      ledger: {covered: [], total_minutes: 0, credit_minor: 0, sequence: 0, head: GENESIS},
    };
    return hash;
  }

  async updateAgreement(method, id, args, role) {
    const agreement = this.getAgreement(id);
    const {terms} = agreement;
    require(this.now < terms.file_by, 'The filing deadline has passed.');
    if (method === 'approve_agreement') {
      require(['customer', 'monitor'].includes(role) && !(role in agreement.approvals), 'This role cannot approve again.');
      require(args[0] === agreement.terms_hash, 'Terms hash changed.');
      agreement.approvals[role] = this.now;
      if (Object.keys(agreement.approvals).length === 3) {
        require(!this.agreements.some((row) => row.id !== id && row.activated_at !== null &&
          row.terms.invoice_line === terms.invoice_line), 'An active agreement already covers this line.');
        agreement.activated_at = this.now;
      }
      return;
    }
    require(agreement.activated_at !== null && role === 'customer', 'The customer can file once all roles have approved.');
    const [title, start, end] = args;
    require(title.trim() && title.length <= 108, 'Enter a case title.');
    require(terms.period_start <= start && start < end && end <= Math.min(this.now, terms.period_end) &&
      end - start <= 7 * DAY, 'Enter a completed window of at most seven days in the billing period.');
    require(agreement.case_ids.length < 24, 'The agreement already has 24 cases.');
    const cid = id + '-' + String(agreement.case_ids.length + 1).padStart(2, '0');
    this.data.cases[cid] = {
      id: cid, title: title.trim(), agreement_id: id, start, end, filed_at: this.now, stage: 'collecting',
      collect_until: this.now + terms.collect_minutes, challenge_until: null, evidence: [], findings: [], challenge: null,
      settlement: null, application: null,
    };
    agreement.case_ids.push(cid);
    return cid;
  }

  async append(record, role, args, status) {
    const [start, end, raw, reference] = args;
    const body = raw.trim();
    require(record.start <= start && start < end && end <= record.end, 'Observation window must be inside the claimed window.');
    require(body && new TextEncoder().encode(body).length <= 1200, 'Enter an observation up to 1,200 bytes.');
    require(!reference || /^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]+(?:[/?#][^\s]*)?$/.test(reference), 'Use a public HTTPS reference.');
    require(status === 'UNCLEAR' || body.length >= 12, 'Add a longer excerpt for a supported observation.');
    const author = DEMO_ACTORS[role];
    const fingerprint = await digest([author, start, end, body]);
    require(!record.evidence.some((item) => item.fingerprint === fingerprint), 'This observation was already submitted.');
    const id = 'e' + (record.evidence.length + 1);
    const row = {id, case_id: record.id, role, author, start, end, body, reference, round: record.findings.length + 1, added_at: this.now, fingerprint};
    row.hash = await digest(row);
    record.evidence.push(row);
    this.data.labels[row.hash] = status;
    return id;
  }

  async updateCase(method, cid, args, role, demoStatus) {
    const record = this.getCase(cid);
    const agreement = this.getAgreement(record.agreement_id);
    const actions = allowedActions(agreement, record, role, this.now);
    if (method === 'attest') {
      require(actions.attest, 'This role cannot attest in the current round.');
      return this.append(record, role, args, demoStatus);
    }
    if (method === 'challenge_case') {
      require(actions.challenge, 'Only the provider or customer can challenge within the window.');
      const [reason, ...evidence] = args;
      require(reason.trim() && reason.length <= 420, 'Enter the challenge reason.');
      record.stage = 'appeal_collecting';
      record.collect_until = this.now + agreement.terms.collect_minutes;
      const evidenceId = await this.append(record, role, evidence, demoStatus);
      record.challenge = {role, author: DEMO_ACTORS[role], reason: reason.trim(), opened_at: this.now,
        new_evidence_id: evidenceId, prior_finding_hash: record.findings.at(-1).hash};
      return evidenceId;
    }
    if (method === 'review_case') {
      require(actions.review, 'Review opens after all roles attest or the collection window expires.');
      const roles = new Set(record.evidence.map((item) => item.role));
      const sufficient = roles.has('monitor') && roles.size > 1;
      const labels = record.evidence.map((item) => {
        const status = sufficient ? this.data.labels[item.hash] : 'UNCLEAR';
        return {id: item.id, status, quote: status === 'UNCLEAR' ? '' : item.body.slice(0, 420)};
      });
      const row = {case_id: cid, round: record.findings.length + 1, reviewed_at: this.now,
        ...computeFinding(record, labels), labels, evidence_hashes: record.evidence.map((item) => item.hash),
        previous_hash: record.findings.at(-1)?.hash ?? GENESIS};
      row.hash = await digest(row);
      record.findings.push(row);
      if (record.stage === 'collecting') {
        record.stage = 'provisional';
        record.challenge_until = this.now + agreement.terms.challenge_minutes;
      } else record.stage = 'reviewed';
      return row.hash;
    }
    if (method === 'finalize_case') {
      require(actions.finalize, 'The case is not ready to settle.');
      const {covered, ...projection} = projectCredit(agreement, record.findings.at(-1).eligible);
      const ledger = agreement.ledger;
      const row = {case_id: cid, sequence: ledger.sequence + 1, finalized_at: this.now,
        terms_hash: agreement.terms_hash, finding_hash: record.findings.at(-1).hash, previous_hash: ledger.head, ...projection};
      row.hash = await digest(row);
      record.stage = 'finalized';
      record.settlement = row;
      agreement.ledger = {covered, total_minutes: row.total_minutes, credit_minor: row.cumulative_minor, sequence: row.sequence, head: row.hash};
      return row.hash;
    }
    if (method === 'record_application') {
      require(actions.application, 'Only the provider can record the application of a memo.');
      const reference = args[0].trim().toUpperCase();
      require(/^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(reference), 'Enter a valid reference.');
      require(!Object.values(this.data.cases).some((row) => row.application?.reference === reference), 'This application reference is already used.');
      record.application = {reference, recorded_at: this.now, acknowledged_at: null};
      return;
    }
    if (method === 'acknowledge_application') {
      require(actions.acknowledge, 'The customer can acknowledge an application the provider has recorded.');
      record.application.acknowledged_at = this.now;
      return;
    }
    throw new Error('Unknown workspace action.');
  }
}

async function seed() {
  const demo = new DemoDesk({now: BASE - 240, agreements: {}, cases: {}, labels: {}});
  const terms = {
    title: 'Atlas Cloud Enterprise', service: 'Atlas API', region: 'EU West', ...DEMO_ACTORS,
    invoice_line: 'ATL-2026-11-01', currency: 'USD', invoice_minor: 840_000, period_start: time('2026-11-01T00:00'),
    period_end: time('2026-12-01T00:00'), file_by: time('2026-12-04T00:00'), collect_minutes: 45, challenge_minutes: 45,
    bands: [[20, 500], [60, 1000], [120, 2500]],
  };
  const id = 'atlas-nov';
  const policy = await demo.propose(id, terms, 'provider');
  await demo.updateAgreement('approve_agreement', id, [policy], 'customer');
  await demo.updateAgreement('approve_agreement', id, [policy], 'monitor');
  const create = async (title, from, to) => demo.updateAgreement('file_case', id, [title, time(from), time(to)], 'customer');
  const text = (start, end) => `${minuteInput(start).slice(11)}–${minuteInput(end).slice(11)} UTC`;
  const post = async (cid, role, start, end, body, status = 'OUTAGE') =>
    demo.updateCase('attest', cid, [start, end, body, ''], role, status);
  const a = await create('EU West API interruption', '2026-11-18T09:00', '2026-11-18T10:32');
  let {start, end} = demo.getCase(a);
  await post(a, 'customer', start, end, `Client incident log · 18 Nov. Atlas API in EU West was completely unreachable from ${text(start, end)}. All requests returned a gateway error.`);
  await post(a, 'provider', start + 2, end, `Atlas status · 18 Nov. Atlas API suffered a full interruption in EU West from ${text(start + 2, end)}.`);
  await post(a, 'monitor', start, end, `Cross-region probe · 18 Nov. EU West Atlas API returned no successful response from ${text(start, end)}.`);
  await demo.updateCase('review_case', a, [], 'customer');
  await demo.updateCase('challenge_case', a, ['Recovery logs show that requests were succeeding before the original end time.',
    start + 62, end, `Atlas recovery report · 18 Nov. Atlas API in EU West remained available from ${text(start + 62, end)}.`, ''], 'provider', 'AVAILABLE');
  await post(a, 'monitor', start + 62, end, `Independent recheck · 18 Nov. EU West Atlas API served continuous successful requests from ${text(start + 62, end)}.`, 'AVAILABLE');
  await post(a, 'customer', start, start + 62, `Client post-incident review · 18 Nov. Atlas API in EU West failed all API calls from ${text(start, start + 62)}.`);
  await demo.updateCase('review_case', a, [], 'customer');
  await demo.updateCase('finalize_case', a, [], 'customer');
  await demo.updateCase('record_application', a, ['CN-1048'], 'provider');
  await demo.updateCase('acknowledge_application', a, [], 'customer');

  const b = await create('Authentication gateway outage', '2026-11-16T17:22', '2026-11-16T18:40');
  const gate = demo.getCase(b);
  for (const role of ROLES) await post(b, role, gate.start, gate.end,
    `${role} incident record · 16 Nov. Atlas API in EU West was unavailable for the full ${text(gate.start, gate.end)} window.`);
  await demo.updateCase('review_case', b, [], 'provider');
  demo.advance(demo.now + 45);
  await demo.updateCase('finalize_case', b, [], 'customer');

  demo.advance(BASE - 12);
  const c = await create('Elevated 5xx responses', '2026-11-20T11:00', '2026-11-20T11:52');
  const elevated = demo.getCase(c);
  await post(c, 'customer', elevated.start, elevated.end, 'Atlas API in EU West showed elevated HTTP 5xx responses. Some requests completed.', 'UNCLEAR');
  await post(c, 'monitor', elevated.start + 10, elevated.end - 7,
    'Atlas API in EU West suffered a complete interruption during the affected probe window.');
  await post(c, 'provider', elevated.start + 10, elevated.end - 7,
    'Atlas API in EU West had a complete interruption during the elevated errors window.');
  await demo.updateCase('review_case', c, [], 'customer');

  demo.advance(BASE);
  const d = await create('Regional timeout report', '2026-11-20T13:10', '2026-11-20T13:45');
  const timeout = demo.getCase(d);
  await post(d, 'customer', timeout.start, timeout.end, 'Atlas API in EU West timed out for the entire outage window.');
  await post(d, 'provider', timeout.start, timeout.end, 'Some EU West tenants reported timeouts. Scope and full downtime are still under investigation.', 'UNCLEAR');

  const draftTerms = {...terms, title: 'Beacon Data Platform', service: 'Beacon ingest', region: 'US East', invoice_line: 'BCN-2026-11-02',
    invoice_minor: 620_000, bands: [[15, 500], [45, 1500], [90, 2500]]};
  const draft = await demo.propose('beacon-nov', draftTerms, 'provider');
  await demo.updateAgreement('approve_agreement', 'beacon-nov', [draft], 'customer');
  demo.save();
  return demo;
}
