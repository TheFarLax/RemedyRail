export const ROLES = ['provider', 'customer', 'monitor'];
export const GENESIS = '0'.repeat(64);
export const DAY = 1440;
export const toMinute = (value) => Math.floor(new Date(value).getTime() / 60_000);
export const minuteInput = (minute) => new Date(minute * 60_000).toISOString().slice(0, 16);
export const parseMinute = (value) => toMinute(`${value}Z`);
export const sumMinutes = (windows) => windows.reduce((total, [start, end]) => total + end - start, 0);

export function union(intervals) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const [start, end] of sorted) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export function intersect(left, right) {
  const result = [];
  let a = 0;
  let b = 0;
  while (a < left.length && b < right.length) {
    const start = Math.max(left[a][0], right[b][0]);
    const end = Math.min(left[a][1], right[b][1]);
    if (start < end) result.push([start, end]);
    if (left[a][1] <= right[b][1]) a++;
    else b++;
  }
  return result;
}

export function subtract(left, right) {
  const result = [];
  for (const [start, end] of left) {
    let cursor = start;
    for (const [low, high] of right) {
      if (high <= cursor) continue;
      if (low >= end) break;
      if (cursor < low) result.push([cursor, low]);
      cursor = Math.max(cursor, high);
      if (cursor >= end) break;
    }
    if (cursor < end) result.push([cursor, end]);
  }
  return result;
}

function corroborated(evidence, labels, status) {
  const matching = evidence.filter((_, index) => labels[index].status === status);
  const monitor = matching.filter(({role}) => role === 'monitor');
  const parties = matching.filter(({role}) => role !== 'monitor');
  return intersect(
    union(monitor.map(({start, end}) => [start, end])),
    union(parties.map(({start, end}) => [start, end])),
  );
}

export function computeFinding(record, labels) {
  const outage = corroborated(record.evidence, labels, 'OUTAGE');
  const availability = corroborated(record.evidence, labels, 'AVAILABLE');
  const eligible = subtract(outage, availability);
  const conflicts = intersect(outage, availability);
  const eligibleMinutes = sumMinutes(eligible);
  let verdict = 'INCONCLUSIVE';
  if (eligibleMinutes) verdict = eligibleMinutes === record.end - record.start ? 'SUPPORTED' : 'PARTIAL';
  else if (!conflicts.length && sumMinutes(availability) === record.end - record.start) verdict = 'DENIED';
  return {eligible, availability, conflicts, eligible_minutes: eligibleMinutes, verdict};
}

export function projectCredit(agreement, eligible) {
  const {terms, ledger} = agreement;
  const covered = union([...ledger.covered, ...eligible]);
  const minutes = sumMinutes(covered);
  const bps = terms.bands.findLast(([threshold]) => threshold <= minutes)?.[1] ?? 0;
  const cumulative = Math.floor(terms.invoice_minor * bps / 10_000);
  return {
    covered, total_minutes: minutes, band_bps: bps, cumulative_minor: cumulative,
    credit_minor: cumulative - ledger.credit_minor, new_windows: subtract(eligible, ledger.covered),
  };
}

function asciiJson(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (char) =>
    '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => asciiJson(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }
  return asciiJson(value);
}

export async function digest(value) {
  const data = new TextEncoder().encode(canonicalJson(value));
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyBundle(bundle) {
  const {agreement, cases} = bundle;
  const {ledger, terms_hash: termsHash} = agreement;
  if (termsHash !== await digest(agreement.terms)) throw new Error('Agreement terms digest does not match.');
  if (cases.length !== agreement.case_ids.length || cases.some((row, index) =>
    row.id !== agreement.case_ids[index] || row.agreement_id !== agreement.id)) {
    throw new Error('The case list does not match the agreement.');
  }
  for (const record of cases) {
    for (const item of record.evidence) {
      const {hash, ...payload} = item;
      if (item.case_id !== record.id || item.author !== agreement.terms[item.role] || hash !== await digest(payload)) {
        throw new Error(`Evidence digest or signer mismatch for ${record.id} / ${item.id}.`);
      }
    }
    let previous = GENESIS;
    for (const finding of record.findings) {
      const {hash, ...payload} = finding;
      const evidence = record.evidence.filter((item) => item.round <= finding.round);
      if (finding.case_id !== record.id || finding.previous_hash !== previous || hash !== await digest(payload) ||
          canonicalJson(finding.evidence_hashes) !== canonicalJson(evidence.map((item) => item.hash))) {
        throw new Error(`Finding digest mismatch for ${record.id}.`);
      }
      if (finding.labels.length !== evidence.length || finding.labels.some(({id, status, quote}, index) =>
        id !== evidence[index].id || !['OUTAGE', 'AVAILABLE', 'UNCLEAR'].includes(status) ||
        (status === 'UNCLEAR' ? quote !== '' : quote.trim().length < 12 || !evidence[index].body.includes(quote)))) {
        throw new Error(`Finding quotes mismatch for ${record.id}.`);
      }
      const expected = computeFinding({...record, evidence}, finding.labels);
      if (Object.keys(expected).some((key) => canonicalJson(expected[key]) !== canonicalJson(finding[key]))) {
        throw new Error(`Finding intervals mismatch for ${record.id}.`);
      }
      previous = hash;
    }
  }
  const finalized = cases.filter(({settlement}) => settlement).sort((a, b) => a.settlement.sequence - b.settlement.sequence);
  const current = {covered: [], total_minutes: 0, credit_minor: 0, sequence: 0, head: GENESIS};
  for (const record of finalized) {
    const {hash, ...row} = record.settlement;
    const finding = record.findings.at(-1);
    const computed = projectCredit({...agreement, ledger: current}, finding.eligible);
    const {covered, ...expected} = computed;
    if (row.case_id !== record.id || row.previous_hash !== current.head || row.sequence !== current.sequence + 1 ||
        row.terms_hash !== termsHash || row.finding_hash !== finding.hash || hash !== await digest(row) ||
        Object.keys(expected).some((key) => canonicalJson(expected[key]) !== canonicalJson(row[key]))) {
      throw new Error(`Settlement does not reconcile for ${record.id}.`);
    }
    Object.assign(current, {covered, total_minutes: row.total_minutes, credit_minor: row.cumulative_minor, sequence: row.sequence, head: hash});
  }
  if (canonicalJson(ledger) !== canonicalJson(current)) throw new Error('Agreement ledger head or totals do not match.');
  return {cases: cases.length, settlements: finalized.length, head: ledger.head};
}

export function allowedActions(agreement, record, role, now) {
  const round = record.findings.length + 1;
  const collecting = ['collecting', 'appeal_collecting'].includes(record.stage);
  const submitted = new Set(record.evidence.filter((item) => item.round === round).map((item) => item.role));
  return {
    attest: collecting && ROLES.includes(role) && now < record.collect_until && !submitted.has(role),
    review: collecting && (now >= record.collect_until || submitted.size === 3),
    challenge: record.stage === 'provisional' && ['customer', 'provider'].includes(role) && now < record.challenge_until,
    finalize: record.stage === 'reviewed' || (record.stage === 'provisional' && now >= record.challenge_until),
    application: record.stage === 'finalized' && record.settlement.credit_minor > 0 && !record.application && role === 'provider',
    acknowledge: record.application && record.application.acknowledged_at === null && role === 'customer',
  };
}
