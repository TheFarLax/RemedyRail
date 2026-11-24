"""GenVM direct-mode regression tests. Web and model calls do not leave the process."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from gltest.direct import VMContext, create_address, deploy_contract

SOURCE = Path(__file__).resolve().parents[1] / "contracts/remedy_rail.py"
NOW = int(datetime(2026, 11, 20, 12, tzinfo=timezone.utc).timestamp()) // 60
PATTERN = "RemedyRail observation policy v1"
GENESIS = "0" * 64


def at(minute):
    return datetime.fromtimestamp(minute * 60, timezone.utc).isoformat()


@pytest.fixture
def env():
    vm = VMContext()
    vm.check_pickling = True
    participants = {role: create_address(role) for role in ("provider", "customer", "monitor", "observer")}
    vm.sender = participants["provider"]
    vm.warp(at(NOW))
    with vm.activate():
        contract = deploy_contract(SOURCE, vm, sdk_version="v0.2.16")
        yield vm, contract, participants


def terms(env, **changes):
    _, _, participants = env
    proposal = {
        "title": "Billing SLA", "service": "Atlas API", "region": "EU West",
        "invoice_line": "INV-441-01", "invoice_minor": 400_003, "currency": "USD",
        "period_start": NOW - 480, "period_end": NOW + 60, "file_by": NOW + 120,
        "collect_minutes": 10, "challenge_minutes": 15, "bands": [[15, 500], [60, 1_000], [120, 2_500]],
    }
    proposal.update({role: "0x" + participants[role].hex() for role in ("provider", "customer", "monitor")})
    proposal.update(changes)
    return proposal


def activate(env, aid="billing", **changes):
    vm, c, participants = env
    with vm.prank(participants["provider"]):
        digest = c.propose_agreement(aid, json.dumps(terms(env, **changes)))
    for role in ("customer", "monitor"):
        with vm.prank(participants[role]):
            c.approve_agreement(aid, digest)
    return digest


def file(env, start=NOW-180, end=NOW-90, aid="billing"):
    vm, c, participants = env
    with vm.prank(participants["customer"]):
        return c.file_case(aid, "API outage", start, end)


def attest(env, cid, role, start=NOW-180, end=NOW-90, status="OUTAGE"):
    vm, c, participants = env
    phrase = "complete interruption" if status == "OUTAGE" else "continuously available"
    body = f"Atlas API in EU West was {phrase} from {at(start)} through {at(end)}."
    with vm.prank(participants[role]):
        c.attest(cid, start, end, body, "")
    return body


def case(env, cid):
    return json.loads(env[1].get_case(cid))


def agreement(env, aid="billing"):
    return json.loads(env[1].get_agreement(aid))


def mock(env, cid, statuses):
    vm = env[0]
    rows = [
        {"id": item["id"], "status": status, "quote": item["body"] if status != "UNCLEAR" else ""}
        for item, status in zip(case(env, cid)["evidence"], statuses)
    ]
    vm.clear_mocks()
    vm.mock_llm(PATTERN, json.dumps({"findings": rows}))
    return rows


def review(env, cid, statuses):
    mock(env, cid, statuses)
    env[1].review_case(cid)
    assert env[0].run_validator()
    return case(env, cid)["findings"][-1]


def digest(row):
    payload = {k: v for k, v in row.items() if k != "hash"}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=True, separators=(",", ":")).encode()).hexdigest()


def test_terms_signatures_are_distinct_and_bound_to_digest(env):
    vm, c, participants = env
    proposed = terms(env)
    with vm.prank(participants["observer"]), vm.expect_revert("Only the named provider"):
        c.propose_agreement("billing", json.dumps(proposed))
    signature = c.propose_agreement("billing", json.dumps(proposed))
    with vm.prank(participants["customer"]), vm.expect_revert("hash does not match"):
        c.approve_agreement("billing", GENESIS)
    with vm.prank(participants["customer"]), vm.expect_revert("All three roles"):
        c.file_case("billing", "Case", NOW-100, NOW-40)
    with vm.prank(participants["observer"]), vm.expect_revert("named customer and monitor"):
        c.approve_agreement("billing", signature)
    with vm.prank(participants["customer"]):
        c.approve_agreement("billing", signature)
        with vm.expect_revert("already approved"):
            c.approve_agreement("billing", signature)
    with vm.prank(participants["monitor"]):
        c.approve_agreement("billing", signature)
    assert agreement(env)["activated_at"] == NOW
    assert json.loads(c.list_agreements(0, 3)) == ["billing"]
    assert json.loads(c.list_agreements(1, 3)) == []


@pytest.mark.parametrize("changes,error", [
    ({"currency": "$US"}, "three letters"),
    ({"invoice_minor": True}, "an integer"),
    ({"invoice_minor": 0}, "supported range"),
    ({"period_start": NOW-60_000}, "31 days"),
    ({"file_by": NOW+15}, "Filing deadline"),
    ({"bands": [[15, 500], [20, 499]]}, "must increase"),
    ({"bands": [[15, 10_001]]}, "must increase"),
    ({"collect_minutes": 0}, "10,080"),
    ({"challenge_minutes": 10_081}, "10,080"),
])
def test_policy_input_validation(env, changes, error):
    with env[0].expect_revert(error):
        env[1].propose_agreement("billing", json.dumps(terms(env, **changes)))


def test_invoice_line_cannot_be_activated_twice(env):
    vm, c, participants = env
    activate(env)
    other = c.propose_agreement("duplicate", json.dumps(terms(env, invoice_line="inv-441-01", title="New terms")))
    with vm.prank(participants["customer"]):
        c.approve_agreement("duplicate", other)
    with vm.prank(participants["monitor"]), vm.expect_revert("already has an active agreement"):
        c.approve_agreement("duplicate", other)
    assert agreement(env, "duplicate")["approvals"].keys() == {"provider", "customer"}


def test_case_guards_and_deadlines(env):
    vm, c, participants = env
    activate(env)
    with vm.expect_revert("Only the named customer"):
        c.file_case("billing", "Case", NOW-180, NOW-90)
    with vm.prank(participants["customer"]), vm.expect_revert("completed window"):
        c.file_case("billing", "Case", NOW-40, NOW+1)
    cid = file(env)
    with vm.expect_revert("Wait for all three"):
        c.review_case(cid)
    with vm.prank(participants["observer"]), vm.expect_revert("Only agreement participants"):
        c.attest(cid, NOW-180, NOW-90, "faked external report", "")
    with vm.prank(participants["customer"]), vm.expect_revert("inside the claim"):
        c.attest(cid, NOW-181, NOW-90, "outside time range", "")
    attest(env, cid, "customer")
    with vm.prank(participants["customer"]), vm.expect_revert("already attested"):
        c.attest(cid, NOW-180, NOW-90, "different report", "")
    vm.warp(at(NOW+10))
    with vm.prank(participants["monitor"]), vm.expect_revert("deadline has passed"):
        c.attest(cid, NOW-180, NOW-90, "submitted too late", "")
    c.review_case(cid)
    finding = case(env, cid)["findings"][0]
    assert finding["verdict"] == "INCONCLUSIVE"
    assert finding["eligible"] == []
    with vm.expect_revert("not ready"):
        c.finalize_case(cid)
    vm.warp(at(NOW+25))
    with vm.prank(participants["provider"]), vm.expect_revert("challenge window is closed"):
        c.challenge_case(cid, "late", NOW-180, NOW-90, "new observation", "")
    c.finalize_case(cid)
    assert case(env, cid)["settlement"]["credit_minor"] == 0


def test_conflicting_two_source_intervals_survive_as_auditable_appeal(env):
    vm, c, participants = env
    activate(env)
    cid = file(env)
    start, end = NOW-180, NOW-90
    for role in ("customer", "provider", "monitor"):
        attest(env, cid, role, start, end)
    first = review(env, cid, ["OUTAGE"]*3)
    assert first["eligible"] == [[start, end]]
    with vm.prank(participants["monitor"]), vm.expect_revert("Only the two"):
        c.challenge_case(cid, "question", start, end, "independent report", "")
    with vm.prank(participants["provider"]):
        with vm.expect_revert("already submitted"):
            c.challenge_case(cid, "duplicate", start, end, case(env, cid)["evidence"][1]["body"], "")
        c.challenge_case(cid, "Recovery was earlier", end-30, end,
                         "Atlas API in EU West remained continuously available for the final 30 minutes.", "")
    assert case(env, cid)["stage"] == "appeal_collecting"
    with vm.expect_revert("not ready"):
        c.finalize_case(cid)
    attest(env, cid, "monitor", end-30, end, "AVAILABLE")
    vm.warp(at(NOW+10))
    second = review(env, cid, ["OUTAGE", "OUTAGE", "OUTAGE", "AVAILABLE", "AVAILABLE"])
    assert second["verdict"] == "PARTIAL"
    assert second["conflicts"] == [[end-30, end]]
    assert second["eligible"] == [[start, end-30]]
    assert second["previous_hash"] == first["hash"] == digest(first)
    assert second["hash"] == digest(second)
    assert case(env, cid)["findings"][0] == first
    c.finalize_case(cid)
    settled = case(env, cid)["settlement"]
    assert settled["finding_hash"] == second["hash"]
    assert settled["credit_minor"] == 40_000
    assert settled["total_minutes"] == 60
    assert settled["hash"] == agreement(env)["ledger"]["head"] == digest(settled)


@pytest.mark.parametrize("bad", ["missing", "quote", "order", "enum", "extra"])
def test_malformed_model_result_rolls_back(env, bad):
    vm, c, _ = env
    activate(env)
    cid = file(env)
    for role in ("customer", "provider", "monitor"):
        attest(env, cid, role)
    rows = mock(env, cid, ["OUTAGE"]*3)
    if bad == "missing":
        rows.pop()
    elif bad == "quote":
        rows[0]["quote"] = "This quotation was never attested."
    elif bad == "order":
        rows.reverse()
    elif bad == "enum":
        rows[0]["status"] = "FRAUD"
    else:
        rows[0]["extra"] = True
    vm.clear_mocks()
    vm.mock_llm(PATTERN, json.dumps({"findings": rows}))
    with vm.expect_revert("did not reach a valid result"):
        c.review_case(cid)
    assert case(env, cid)["findings"] == []
    assert case(env, cid)["stage"] == "collecting"


def test_independent_validators_reject_divergent_impact(env):
    vm, _, _ = env
    activate(env)
    cid = file(env)
    for role in ("customer", "provider", "monitor"):
        attest(env, cid, role)
    review(env, cid, ["OUTAGE"] * 3)
    mock(env, cid, ["OUTAGE", "OUTAGE", "UNCLEAR"])
    assert vm.run_validator() is False


@pytest.mark.parametrize("statuses,verdict,minutes", [
    (["OUTAGE", "OUTAGE", "UNCLEAR"], "INCONCLUSIVE", 0),
    (["AVAILABLE", "OUTAGE", "AVAILABLE"], "DENIED", 0),
    (["OUTAGE", "AVAILABLE", "OUTAGE"], "SUPPORTED", 90),
    (["AVAILABLE", "AVAILABLE", "OUTAGE"], "INCONCLUSIVE", 0),
])
def test_monitor_and_party_corroboration(env, statuses, verdict, minutes):
    activate(env)
    cid = file(env)
    for role in ("customer", "provider", "monitor"):
        attest(env, cid, role)
    finding = review(env, cid, statuses)
    assert finding["verdict"] == verdict
    assert finding["eligible_minutes"] == minutes


def test_coverage_union_and_incremental_bands_are_order_safe(env):
    vm, c, participants = env
    activate(env)
    windows = [(NOW-190, NOW-120), (NOW-140, NOW-50), (NOW-180, NOW-130)]
    ids = []
    for start, end in windows:
        cid = file(env, start, end)
        ids.append(cid)
        for role in ("customer", "provider", "monitor"):
            attest(env, cid, role, start, end)
        review(env, cid, ["OUTAGE"]*3)
    vm.warp(at(NOW+15))
    a, b, duplicate = ids
    for cid in (b, a, duplicate):
        c.finalize_case(cid)
    assert [case(env, cid)["settlement"]["credit_minor"] for cid in (b, a, duplicate)] == [40_000, 60_000, 0]
    first, second, third = [case(env, cid)["settlement"] for cid in (b, a, duplicate)]
    assert second["previous_hash"] == first["hash"] and third["previous_hash"] == second["hash"]
    assert third["new_windows"] == []
    assert agreement(env)["ledger"]["covered"] == [[NOW-190, NOW-50]]
    assert agreement(env)["ledger"]["credit_minor"] == 100_000
    with vm.expect_revert("not ready"):
        c.finalize_case(a)
    with vm.prank(participants["customer"]), vm.expect_revert("Only the provider"):
        c.record_application(a, "CN-100")
    with vm.expect_revert("no credit memo"):
        c.record_application(duplicate, "CN-100")
    with vm.prank(participants["customer"]), vm.expect_revert("has not recorded"):
        c.acknowledge_application(a)
    c.record_application(a, "cn-100")
    with vm.expect_revert("already in use"):
        c.record_application(b, "CN-100")
    with vm.prank(participants["customer"]):
        c.acknowledge_application(a)
        with vm.expect_revert("already acknowledged"):
            c.acknowledge_application(a)
    assert case(env, a)["application"] == {"reference": "CN-100", "recorded_at": NOW+15, "acknowledged_at": NOW+15}
