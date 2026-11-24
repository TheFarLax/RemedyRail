"""Deploy and exercise RemedyRail with three disposable Studionet accounts."""
import argparse
import base64
import hashlib
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import requests
from eth_utils import to_checksum_address
from genlayer_py import create_account
from genlayer_py.chains import studionet
from genlayer_py.client import GenLayerClient
from genlayer_py.provider import GenLayerProvider
from genlayer_py.types import TransactionHashVariant

SOURCE = Path(__file__).resolve().parents[1] / "contracts" / "remedy_rail.py"
RPC = "https://studio.genlayer.com/api"
EXPLORER = "https://explorer-studio.genlayer.com"
CHAIN = 61999
ROLES = ("provider", "customer", "monitor")


class StudioProvider(GenLayerProvider):
    def __init__(self):
        super().__init__(RPC)
        self.session = requests.Session()

    def make_request(self, method, params):
        attempts = 1 if method in ("eth_sendRawTransaction", "sim_fundAccount") else 3
        for attempt in range(attempts):
            try:
                res = self.session.post(
                    RPC, json={"jsonrpc": "2.0", "method": method, "params": params, "id": 1}, timeout=(12, 22)
                )
                res.raise_for_status()
                payload = res.json()
                self._raise_on_error(payload, method)
                return payload
            except (requests.RequestException, ValueError):
                if attempt + 1 == attempts:
                    raise
                time.sleep(2 * (attempt + 1))
        raise RuntimeError("RPC retry limit reached.")


def rpc(provider, method, *params):
    return provider.make_request(method, list(params))["result"]


def connect(account):
    client = GenLayerClient(studionet, account)
    client.provider = StudioProvider()
    client.w3.provider = client.provider
    client.initialize_consensus_smart_contract()
    return client


def fund(account):
    provider = StudioProvider()
    if int(rpc(provider, "eth_getBalance", account.address, "latest"), 16) > 0:
        return
    try:
        rpc(provider, "sim_fundAccount", account.address, 20 * 10**18)
    except requests.RequestException:
        print("Faucet response was interrupted. Checking for the transfer.", flush=True)
    for _ in range(14):
        if int(rpc(provider, "eth_getBalance", account.address, "latest"), 16) > 0:
            return
        time.sleep(2)
    raise RuntimeError(f"Studionet faucet has not funded {account.address}.")


def save(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def read(client, address, method, *args):
    return json.loads(client.read_contract(address=address, function_name=method, args=list(args),
        transaction_hash_variant=TransactionHashVariant.LATEST_FINAL))


def as_utc(minute):
    return datetime.fromtimestamp(minute * 60, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def wait(provider, label, tx_hash, seconds=360):
    last = None
    stop_at = time.monotonic() + seconds
    while time.monotonic() < stop_at:
        try:
            receipt = rpc(provider, "eth_getTransactionByHash", tx_hash)
        except requests.RequestException:
            receipt = None
        if receipt:
            status = receipt.get("status")
            if status != last:
                print(f"{label}: {status} {tx_hash}", flush=True)
                last = status
            if status in ("CANCELED", "CANCELLED"):
                raise RuntimeError(f"{label} was canceled: {tx_hash}")
            if status == "FINALIZED":
                leader = (receipt.get("consensus_data") or {}).get("leader_receipt", {})
                if isinstance(leader, list):
                    leader = leader[-1] if leader else {}
                output = leader.get("genvm_result") or {}
                winner = receipt.get("result_name")
                execution = leader.get("execution_result")
                quorum = output.get("error_code") == "CONSENSUS_VALIDATOR_QUORUM_REACHED"
                if execution != "SUCCESS" and not (quorum and winner in ("MAJORITY_AGREE", "UNANIMOUS_AGREE")):
                    raise RuntimeError(f"{label} execution failed: {output.get('error_description') or output.get('error_code') or execution}")
                return {"hash": tx_hash, "status": status, "consensus": winner, "execution": execution,
                    "execution_code": output.get("error_code"), "to": receipt.get("to_address"),
                    "explorer_url": f"{EXPLORER}/tx/{tx_hash}"}
        time.sleep(3)
    raise TimeoutError(f"{label} is still pending at {last}: {tx_hash}. Run the same command to resume.")


def run(output):
    output.mkdir(parents=True, exist_ok=True)
    provider = StudioProvider()
    if int(rpc(provider, "eth_chainId"), 16) != CHAIN or studionet.id != CHAIN:
        raise RuntimeError("Unexpected chain. This script requires Studionet 61999.")
    keys = output / "wallets.private.json"
    report_path = output / "studionet-report.json"
    if keys.exists():
        accounts = {role: create_account(key) for role, key in json.loads(keys.read_text()).items()}
    else:
        accounts = {role: create_account() for role in ROLES}
        with os.fdopen(os.open(keys, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as file:
            json.dump({role: account.key.hex() for role, account in accounts.items()}, file)
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(fund, accounts.values()))
    clients = {role: connect(account) for role, account in accounts.items()}
    client = clients["provider"]
    source = SOURCE.read_bytes()
    source_hash = hashlib.sha256(source).hexdigest()
    addresses = {role: accounts[role].address for role in ROLES}
    report = json.loads(report_path.read_text()) if report_path.exists() else {
        "project": "RemedyRail", "network": "Studionet", "chain_id": CHAIN, "source_sha256": source_hash,
        "actors": addresses, "transactions": {}, "scenario_is_synthetic": True,
        "scenario_start": int(time.time() // 60) - 180,
    }
    if report["source_sha256"] != source_hash or report["actors"] != addresses:
        raise RuntimeError("Source or wallets changed. Use a new output directory.")
    address = report.get("contract_address")

    def transact(label, role, method, args=()):
        prior = report["transactions"].get(label)
        if prior and prior.get("status") == "FINALIZED":
            return prior
        if not prior:
            sender = clients[role]
            tx = sender.deploy_contract(code=source, args=[], leader_only=False) if method == "deploy" else \
                sender.write_contract(address=address, function_name=method, args=list(args), leader_only=False)
            prior = {"hash": tx, "method": method, "role": role}
            report["transactions"][label] = prior
            save(report_path, report)
            print(f"{label}: submitted {tx}", flush=True)
        final = wait(provider, label, prior["hash"])
        prior.update(final)
        save(report_path, report)
        return prior

    deploy = transact("deployment", "provider", "deploy")
    address = to_checksum_address(deploy["to"])
    raw = rpc(provider, "gen_getContractCode", address)
    raw = raw["code"] if isinstance(raw, dict) else raw
    onchain_hash = hashlib.sha256(base64.b64decode(raw, validate=True)).hexdigest()
    if onchain_hash != source_hash or read(client, address, "get_policy")["name"] != "RemedyRail":
        raise RuntimeError("Deployment verification failed.")
    report.update(contract_address=address, explorer_url=f"{EXPLORER}/address/{address}",
                  onchain_source_sha256=onchain_hash, source_matches_onchain=True)
    save(report_path, report)

    aid = "nimbus-pilot"
    cid = aid + "-01"
    start = report["scenario_start"]
    end = start + 90
    terms = {"title": "Nimbus API pilot", "service": "Nimbus API", "region": "EU West", **addresses,
        "invoice_line": "NIMBUS-PILOT-01", "currency": "USD", "invoice_minor": 400_000,
        "period_start": start - 1440, "period_end": start + 7 * 1440, "file_by": start + 9 * 1440,
        "collect_minutes": 25, "challenge_minutes": 25, "bands": [[15, 500], [60, 1000], [120, 2500]]}

    transact("terms_proposed", "provider", "propose_agreement", [aid, json.dumps(terms)])
    policy = read(client, address, "get_agreement", aid)
    for role in ("customer", "monitor"):
        transact("terms_" + role, role, "approve_agreement", [aid, policy["terms_hash"]])
    transact("case_filed", "customer", "file_case", [aid, "EU West API interruption", start, end])

    def evidence(role, a, b, availability, prefix):
        phrase = "remained fully available, with successful requests throughout" if availability else "was completely unavailable, with no successful requests"
        body = f"{role.title()} {prefix}. Nimbus API in EU West {phrase} from {as_utc(a)} to {as_utc(b)}."
        return [a, b, body, ""]

    for role in ("provider", "customer", "monitor"):
        transact("initial_" + role, role, "attest", [cid, *evidence(role, start, end, False, "incident report")])
    transact("initial_review", "customer", "review_case", [cid])
    first = read(client, address, "get_case", cid)["findings"][0]
    if first["eligible_minutes"] != 90:
        raise RuntimeError("Initial live finding does not match the synthetic evidence.")
    correction = end - 30
    transact("challenge", "provider", "challenge_case", [cid, "A second telemetry review established earlier recovery.",
        *evidence("provider", correction, end, True, "correction")])
    transact("appeal_monitor", "monitor", "attest", [cid, *evidence("monitor", correction, end, True, "independent recheck")])
    transact("appeal_customer", "customer", "attest", [cid, *evidence("customer", start, correction, False, "reconciled log")])
    transact("appeal_review", "customer", "review_case", [cid])
    reviewed = read(client, address, "get_case", cid)
    if reviewed["findings"][-1]["eligible_minutes"] != 60 or reviewed["findings"][0] != first:
        raise RuntimeError("The corrected finding does not preserve the expected 90-to-60-minute transition.")
    transact("settlement", "customer", "finalize_case", [cid])
    transact("memo_applied", "provider", "record_application", [cid, "NIMBUS-CN-001"])
    transact("memo_acknowledged", "customer", "acknowledge_application", [cid])
    record = read(client, address, "get_case", cid)
    agreement = read(client, address, "get_agreement", aid)
    if record["settlement"]["credit_minor"] != 40_000 or not record["application"]["acknowledged_at"]:
        raise RuntimeError("The live credit memo did not reconcile.")
    report.update(scenario_status="passed", agreement_id=aid, case_id=cid, first_eligible_minutes=90,
        final_eligible_minutes=60, credit_minor=40_000, currency="USD",
        agreement=agreement, cases=[record], finalized_transactions=len(report["transactions"]))
    save(report_path, report)
    print(f"Verified {len(report['transactions'])} finalized transactions. Contract {report['explorer_url']}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True, help="Private directory for disposable wallets and resumable transaction records")
    run(parser.parse_args().output_dir)
