# RemedyRail

**Turn outage evidence into an auditable service-credit memo.**

RemedyRail is a GenLayer application for SaaS customers, providers and independent monitors. They approve an invoice-scoped SLA, sign outage observations and resolve disputed minutes before issuing an on-chain credit memo. A provider can record the reference from its billing system. The customer can acknowledge that entry independently.

## Try it

The app opens with a synthetic, interactive demo. No wallet is needed.

1. Open **EU West API interruption**. Compare the outage and disputed windows on the timeline.
2. Open **Decision history** to inspect the original finding, the reason for the challenge and the corrected finding.
3. Select **Elevated 5xx responses** to try a sample challenge. Switch demo roles to submit from another participant, then use **Advance demo clock** when you want to close a window.
4. Open **Credit ledger** to see the incremental credit memos. Export the audit bundle and verify its digests and calculation in the browser.
5. Select **Demo data → Open live case** to load finalized Studionet state. Connect an EIP-1193 wallet when you want to submit a write on Studionet.

## Live Studionet evidence

- [Studionet contract 0x537Ac87a6e3F9f205DAeA71d152eB6A31abAd698](https://explorer-studio.genlayer.com/address/0x537Ac87a6e3F9f205DAeA71d152eB6A31abAd698)
- The three roles used separate disposable test wallets on chain **61999**.
- In synthetic case `nimbus-pilot-01`, the finding went from **90 eligible minutes** to **60** after the provider and monitor submitted new evidence. The contract issued a **400.00 USD credit memo** and recorded the customer acknowledgment.
- [Studionet verification report](docs/studionet-report.json) includes 16 finalized transaction receipts, both findings, final case state and the checked match between the deployed source and the packaged contract.
- [Wallet adapter verification](docs/wallet-sdk-report.json) covers a separate finalized write through a scripted EIP-1193 signer.
- [GenVM source](contracts/remedy_rail.py), [consensus and contract tests](tests/test_remedy_rail.py), and [browser calculation and audit tests](tests/model.test.js).

## Run locally

Use Node.js 22.12+ or 24.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. The ZIP also includes the built UI. To serve it without installing Node packages, run `python3 -m http.server 8080 --directory dist` and open `http://localhost:8080`.

In an injected-wallet browser, select **Demo data → Open live case → Connect wallet**. Use Studionet test GEN for gas. To create your own agreement, propose as the provider, then approve with the two designated customer and monitor wallets. Only a party to the relevant agreement can submit observations, challenge a finding or reconcile a memo.

## Decision and settlement rules

1. **Commit terms.** The provider proposes an immutable invoice line, service, region, billing period, filing deadline, evidence and challenge windows, and increasing downtime tiers. The customer and monitor each approve its SHA-256 digest. An invoice line can activate once for a provider and customer pair.
2. **Collect attestations.** The customer files a completed UTC incident window. Each participant can sign one bounded observation per round. Each record binds the observation to its author, case and interval. A round opens for review after all three roles attest or the deadline passes.
3. **Classify the evidence.** The GenLayer leader classifies each observation as full outage, availability or unclear against the fixed service, region and time interval. Independent validators rerun the classification and compare all ordered labels. The contract checks that supporting quotes appear verbatim in the committed evidence.
4. **Calculate eligible minutes.** Merge monitor and billing-party observations separately for each label. Take their intersection to find corroborated coverage. Exclude time where both full outage and availability are corroborated. Incomplete evidence can resolve as inconclusive.
5. **Challenge once.** A billing party can add new evidence before the application deadline. The other roles can attest again. The second finding links to the first and retains both reviews. A software challenge here is an application transaction. GenLayer's protocol-level appeals follow the network lifecycle.
6. **Settle against the invoice.** Union eligible windows with earlier finalizations. Find the highest reached credit band. Calculate the credit in integer minor units, then subtract the amount already credited. Every settlement commits the previous ledger head and the new credit delta. A duplicate window adds zero credit.
7. **Reconcile the memo.** The provider adds a unique billing reference for a finalized positive credit. The customer can acknowledge it independently.

```text
eligible = (monitor_outage ∩ party_outage) − (monitor_available ∩ party_available)
new_coverage = union(existing_coverage, eligible)
cumulative_credit = floor(invoice_minor × credit_band_bps / 10,000)
memo_delta = cumulative_credit − previous_cumulative_credit
```

## What the application verifies

Validators interpret wallet-attested observations. The named monitor must be selected and trusted by both billing parties. References are review links, and the contract uses the on-chain excerpts for adjudication. The app stores evidence excerpts publicly. Use redacted reports that you are authorized to publish.

A credit memo represents a recorded adjustment in the selected currency. The provider applies it through the billing system. Already finalized memos stay in the ledger, including when later incident windows overlap. Export verification recomputes terms, evidence and finding digests, interval arithmetic and the settlement hash chain. Use finalized contract state or the explorer to authenticate the export's origin and application acknowledgments.

## Reproduce the checks

```sh
npm test
npm run build

python3.12 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python -m pytest tests/test_remedy_rail.py -q
genvm-lint check contracts/remedy_rail.py
```

The direct contract suite mocks model responses and exercises the actual GenVM SDK. It verifies role and time gates, incorrect model output, independent validator disagreement, signed counter-evidence, overlapping settlements, memo reconciliation and state rollback. The browser calculation tests also verify the real agreement, findings and ledger from the included Studionet report.

For a fresh synthetic on-chain demonstration, run `python scripts/studionet_demo.py --output-dir local-deployment`. The script funds three disposable Studionet accounts, stores pending transaction hashes for resumable runs, matches deployed source bytes and confirms the final state. Keep `wallets.private.json` private. To point a build at a different deployment, change `src/deployment.json` or paste the contract address in **Workspace connection**.

## GitHub Pages

Push this directory's contents to a new repository. In **Settings → Pages → Build and deployment**, choose **GitHub Actions**. The included workflow runs the test suites, builds the UI and publishes `dist/`. [Portal submission draft](docs/PORTAL_SUBMISSION.md).
