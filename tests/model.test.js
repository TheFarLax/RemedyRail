import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {DemoDesk} from '../src/demo.js';
import {allowedActions, canonicalJson, computeFinding, intersect, projectCredit, subtract, union, verifyBundle} from '../src/model.js';

test('half-open interval algebra joins only coverage and removes disputed windows', () => {
  assert.deepEqual(union([[40,70],[0,10],[10,30],[50,80]]), [[0,30],[40,80]]);
  assert.deepEqual(intersect([[0,20],[40,50]], [[10,40],[45,60]]), [[10,20],[45,50]]);
  assert.deepEqual(subtract([[0,90]], [[0,4],[20,30],[50,100]]), [[4,20],[30,50]]);
});

test('overlapping cases receive only their incremental credit after earlier settlements', () => {
  const terms = {invoice_minor:400_003, bands:[[20,500],[60,1000],[120,2500]]};
  const ledger = {covered:[[100,180]], credit_minor:40_000};
  const first = projectCredit({terms,ledger}, [[160,230]]);
  assert.deepEqual(first.new_windows, [[180,230]]);
  assert.equal(first.total_minutes, 130);
  assert.equal(first.credit_minor, 60_000);
  const duplicate = projectCredit({terms,ledger}, [[120,150]]);
  assert.equal(duplicate.credit_minor, 0);
});

test('one billing party cannot establish a contradiction without the monitor', () => {
  const evidence = [{role:'customer',start:0,end:90},{role:'monitor',start:0,end:90},{role:'provider',start:60,end:90}];
  const labels = ['OUTAGE','OUTAGE','AVAILABLE'].map((status) => ({status}));
  assert.equal(computeFinding({start:0,end:90,evidence}, labels).eligible_minutes, 90);
  evidence.push({role:'monitor',start:60,end:90});
  labels.push({status:'AVAILABLE'});
  const result = computeFinding({start:0,end:90,evidence}, labels);
  assert.deepEqual(result.eligible, [[0,60]]);
  assert.deepEqual(result.conflicts, [[60,90]]);
});

test('canonical JSON matches Python ensure_ascii encoding', () => {
  assert.equal(canonicalJson({z:'🚦',a:['é','\u007f',null]}), '{"a":["\\u00e9","\\u007f",null],"z":"\\ud83d\\udea6"}');
});

test('seed demo produces a verifiable audit trail with a challenge history', async () => {
  const desk = await DemoDesk.load();
  const agreement = desk.agreements[0];
  const cases = agreement.case_ids.map((id) => desk.getCase(id));
  const result = await verifyBundle({agreement, cases});
  assert.equal(result.settlements, 2);
  assert.equal(agreement.ledger.credit_minor, 210_000);
  assert.deepEqual(cases[0].findings.map(({eligible_minutes}) => eligible_minutes), [92,62]);
});

test('demo challenge lifecycle preserves first review and allows deadline advancement', async () => {
  const desk = await DemoDesk.load();
  const agreement = desk.agreements[0];
  const cid = agreement.case_ids[2];
  const before = desk.getCase(cid);
  const first = before.findings[0];
  assert.equal(allowedActions(agreement, before, 'monitor', desk.now).challenge, false);
  await desk.write('challenge_case', [cid,'Telemetry shows recovery.',before.start+20,before.end-7,
    'Atlas API in EU West was continuously available during this interval.', ''], 'provider', 'AVAILABLE');
  await assert.rejects(() => desk.write('finalize_case', [cid], 'customer'), /not ready/);
  const current = desk.getCase(cid);
  await desk.write('attest', [cid,current.start+20,current.end-7,
    'Independent monitor confirms continuous availability across the interval.', ''], 'monitor', 'AVAILABLE');
  desk.advance(desk.getCase(cid).collect_until);
  await desk.write('review_case', [cid], 'customer');
  await desk.write('finalize_case', [cid], 'provider');
  const settled = desk.getCase(cid);
  assert.equal(settled.stage, 'finalized');
  assert.deepEqual(settled.findings[0],first);
  assert.equal(settled.findings[1].eligible_minutes, 10);
  assert.equal(settled.settlement.credit_minor, 0);
});

const live = JSON.parse(readFileSync(new URL('../docs/studionet-report.json', import.meta.url), 'utf8'));

test('the independently calculated browser bundle verifies the real Studionet settlement', async () => {
  const result = await verifyBundle(live);
  assert.equal(result.head, live.agreement.ledger.head);
  assert.equal(result.settlements, 1);
  assert.equal(live.source_matches_onchain, true);
  assert.equal(live.finalized_transactions, 16);
  assert.deepEqual(live.cases[0].findings.map(({eligible_minutes}) => eligible_minutes), [90,60]);
});

test('bundle verification rejects changes to observations, findings and credit amounts', async () => {
  for (const tamper of [
    (bundle) => { bundle.cases[0].evidence[0].body += ' edited'; },
    (bundle) => { bundle.cases[0].findings[0].eligible_minutes = 60; },
    (bundle) => { bundle.cases[0].settlement.credit_minor += 1; },
  ]) {
    const bundle = structuredClone(live);
    tamper(bundle);
    await assert.rejects(() => verifyBundle(bundle));
  }
});
