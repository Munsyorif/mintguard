# MintGuard — a read-only BSC mint/claim verification agent

> **You are about to sign a mint. Is it really free? Is the contract even real?**
> MintGuard checks first — and answers SAFE / CAUTION / BLOCKED, with evidence.

MintGuard is a **wallet & transaction guard** agent for BSC (chain 56). Before you
sign a mint or claim transaction, you ask MintGuard to verify it on-chain. It
reads the contract, checks the price, checks whether it is paused, simulates
the exact call you are about to make, and returns a verdict with the evidence
behind it.

It is **read-only**: it never signs, never holds keys, never sends a
transaction. All it does is `eth_getCode` / `eth_call` against public BSC RPCs
and a source lookup on Sourcify.

Built for the [Agent Games](https://agentgames.zkverify.io/) Wildcard track
(2026 season, closes 21 Nov 2026).

- **Repo:** https://github.com/Munsyorif/mintguard
- **Live demo:** https://bold-union-ca37.munsyorifaji.workers.dev/
- **Test evidence:** [`demo.md`](demo.md) — real recorded outputs, 34/34 checks pass.

## Who it helps

Anyone who mints or claims on BSC — especially AI-agent users, whose agents
execute transactions on their behalf. A project site can say "free" while the
contract charges 0.0012 BNB. A price quote can assume the very grant it is
supposed to check. A clean simulation proves a call won't revert — not what
the call does. MintGuard is the check that runs before the signature.

Real cases it catches (all verified on-chain during development, see `demo.md`):

| Case | What MintGuard found |
|---|---|
| DYOR NFT `mint()` value 0 | **BLOCKED** — the call reverts on-chain (the wallet's free mint was already used) |
| PoA NFT | `PRICE()` = 1,500,000,000,000,000 wei (0.0015 BNB) — **not free**, even though the free phase was advertised |
| BOBBIE NFT | `paused()` = false, source verified — clean, but no price getter exists, so price is unknown |
| Dead address `0x1111…` | **BLOCKED** — no contract code at the address |

## How it works

One request, six checks, one verdict. `POST /verify` runs:

1. **contractExists** — `eth_getCode` non-empty. (BSC RPCs sometimes return
   empty code for live contracts, so a failed `getCode` is double-checked with
   a `totalSupply()` / `paused()` view-call probe.)
2. **sourceVerified** — Sourcify v2 lookup. 200 = verified (`exact` /
   `partial`), 404 = unverified.
3. **notPaused** — `paused()` view call. No `paused()` on the contract =
   `unknown`, not a failure.
4. **priceDiscovery** — tries no-arg price getters in order: `mintPrice()`,
   `PRICE()`, `price()`, `cost()`, `mintCost()`, `getPrice()`, `MINT_PRICE()`.
   First one that answers wins.
5. **freeSupply** — best effort: `remainingFor(address)`, `freeSupply()`,
   `remainingSupply()`, `totalSupply()`, `maxSupply()`. Informational only —
   it never fails the verdict on its own.
6. **simulation** — `eth_call` with your wallet as `from`, your exact
   calldata, and your value. Reports success or the revert reason
   (`Error(string)` decoded when present).

### Verdict rules

- **BLOCKED** if: no contract code, OR `paused() == true`, OR the simulation
  reverts, OR a discovered price differs from `expectedValue` (when provided).
- **CAUTION** if: source unverified, OR no simulation was attempted (no
  function/calldata given), OR the price could not be determined and the
  simulation did not succeed, OR the pause state is unknown without a verified
  source + passing simulation.
- **SAFE** only if: contract exists + source verified + not paused (pause
  unknown is OK only when the source is verified AND the simulation passes) +
  simulation succeeds + price check passed. The price check passes when the
  discovered price equals `expectedValue`, or when no price getter exists but
  the simulation with the provided value succeeded — the chain itself just
  proved the value works.

The exact rule is implemented in `decideVerdict()` in `worker.js` and
documented there, so the verdict is auditable from the code.

## API

All JSON, CORS open. BSC chain 56 only.

### `GET /`

Agent info + a small HTML demo page: a form (contract, wallet, function, args,
value) with a Verify button that calls `/verify` and renders the verdict.

### `GET /health`

```json
{"ok": true, "chain": 56, "rpc": "https://bsc.publicnode.com"}
```

### `POST /verify` — the full check

```bash
curl -X POST https://<your-worker>/verify \
  -H 'Content-Type: application/json' \
  -d '{"contract":"0xbf7332b1787d916331b592361cb018a1e9aed1cd","wallet":"0xdB7CAcF14A5F67BA005FAc84d41fDDF28d1A34B6","function":"totalSupply","args":[],"value":"0"}'
```

Body:

| Field | Required | Description |
|---|---|---|
| `contract` | yes | `0x` address of the mint/claim contract |
| `wallet` | no | the signer, used as `from` (default: zero address) |
| `function` | no | e.g. `mint`, `mint(uint256)`, `paused` — signature, with or without types |
| `args` | no | JSON array of arguments, matching the function types |
| `value` | no | decimal wei string sent with the call (default `"0"`) |
| `calldata` | no | raw `0x` calldata — overrides `function` + `args` |
| `expectedValue` | no | decimal wei string — BLOCKED if the discovered price differs |

Response:

```json
{
  "verdict": "SAFE",
  "checks": [
    {"name": "contractExists", "status": "pass", "detail": "code present (7557 bytes)"},
    {"name": "sourceVerified", "status": "pass", "detail": "Sourcify exact match"},
    {"name": "notPaused", "status": "unknown", "detail": "no paused() on this contract"},
    {"name": "priceDiscovery", "status": "pass", "detail": "PRICE() = 1500000000000000 wei"},
    {"name": "freeSupply", "status": "pass", "detail": "totalSupply() = 1014"},
    {"name": "simulation", "status": "pass", "detail": "eth_call succeeded for totalSupply with value 0 wei"}
  ],
  "evidence": {
    "sourcify": "exact",
    "priceWei": "1500000000000000",
    "priceGetter": "PRICE()",
    "simulation": "success",
    "revertReason": null,
    "paused": null,
    "supply": {"totalSupply()": "1014"}
  },
  "summary": "SAFE: contract exists and is source-verified, not paused, price 1500000000000000 wei found, and the call simulates cleanly."
}
```

### `POST /quote` — "is it really free?" (no simulation)

```bash
curl -X POST https://<your-worker>/quote \
  -H 'Content-Type: application/json' \
  -d '{"contract":"0xbf7332b1787d916331b592361cb018a1e9aed1cd","wallet":"0xdB7CAcF14A5F67BA005FAc84d41fDDF28d1A34B6"}'
```

Runs checks 1–5 only and returns the discovered price / supply / paused state
plus `free` (`true` if the discovered price is 0, `false` if it is non-zero,
`null` if no price getter answered).

## Deploy (Cloudflare Workers, no build step)

1. Go to the [Cloudflare dashboard](https://dash.cloudflare.com/) → Workers &
   Pages → Create → Worker.
2. Delete the template code, paste the entire contents of `worker.js`, Deploy.
3. Your endpoint is `https://<name>.<subdomain>.workers.dev`.
4. Check it: `curl https://<name>.<subdomain>.workers.dev/health` →
   `{"ok": true, "chain": 56, ...}`.
5. Open the root URL in a browser for the demo form.

No `wrangler.toml`, no environment variables, no secrets. The Worker is a
single file with zero dependencies.

## Run the tests

```bash
node test-verify.mjs   # plain node, no deps; imports the same worker.js
```

The script first checks the vendored keccak256 + ABI encoder against known
vectors (offline), then runs live checks against real BSC contracts through
the Worker's own RPC layer. Recorded outputs: [`demo.md`](demo.md)
(34 passed, 0 failed, 2026-11-15).

## Key decisions

- **Single file, zero dependencies.** A Worker you paste into the dashboard
  is the smallest thing that can be a real public endpoint. No build, no
  install, nothing to go stale.
- **Vendored keccak256 + minimal ABI codec.** WebCrypto has no keccak, and
  the Worker needs function selectors (`paused()` = `0x5c975abb`, …) and call
  encoding to work at all. The implementation is verified against known test
  vectors in `test-verify.mjs`.
- **Public RPCs with fallback + retry.** `bsc.publicnode.com` first,
  `1rpc.io/bnb` second; 429s back off and retry. A revert is a *result*, not
  a transport failure — it is returned, never retried.
- **Unknown is not fail.** A missing `paused()` or price getter means "could
  not determine", not "bad". Only hard facts (no code, paused, revert, price
  mismatch) block. This is what keeps the verdicts honest instead of noisy.
- **Read-only by construction.** There is no signing code, no key handling,
  no transaction sending anywhere in the file. The worst the agent can do is
  return a wrong verdict — which is why every verdict carries its evidence.

## Limits (v1, honest)

- **BSC only.** Chain 56. Other chains are a config change, not a redesign,
  but they are not wired in.
- **No-arg price getters only.** If a contract prices mints through a
  function that takes arguments (e.g. `price(uint256)`), price discovery
  misses it — the simulation with your value is then the check that matters.
- **No approval / allowance check.** v1 does not inspect token approvals or
  allowances; a mint that needs an approval is not flagged. Planned for v2.
- **Public RPC rate limits.** Heavy use can hit 429s; the Worker retries with
  backoff and falls back to the second RPC, but responses get slower.
- **A fallback function can fool a view call.** A contract whose fallback
  returns 32 zero bytes for any selector would look like it has `paused() =
  false`. The simulation + source checks are the backstop, not any single
  getter.
- **A passing simulation is not a guarantee.** It proves the call works *at
  the simulated block, from your address, with your value*. State can change
  before you sign. Re-check right before signing.

## zkVerify note (honest)

**zkVerify is NOT integrated.** No proof is generated, no proof is verified,
and nothing in this repo claims otherwise.

What MintGuard does today is verification by *re-reading*: every value the
verdict relies on (code, price, pause state, simulation result) comes from a
public on-chain read that anyone can repeat and check. The verdict is
transparent, but it is still the agent's word — you trust it, or you redo the
reads yourself.

The checkable claim for a future zkVerify integration is: *"the price and
supply values this verdict relied on are the values the chain returned"* —
provable by turning the RPC responses MintGuard relied on into a
zkVerify-checkable claim (via zkTLS over the RPC responses), so a verdict
would arrive with a proof instead of a promise. That is the next step, not
the current state.

## License

MIT. See `LICENSE` (same as the repo).
