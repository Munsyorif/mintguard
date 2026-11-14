# Agent Games — Wildcard submission texts

Repo: https://github.com/Munsyorif/mintguard
Live endpoint: <the deployed Cloudflare Worker URL — fill in after deploy>
Demo: open the endpoint root URL in a browser (built-in demo form).
Test evidence: demo.md in the repo (34/34 checks pass, real on-chain outputs).

---

## USE CASE

**Problem.** Before you sign a mint or claim on BSC, the only question that
matters is: is this transaction what it claims to be? Project sites say
"free" while the contract charges. A price quote can assume the very grant it
is supposed to check. A clean simulation proves a call won't revert — not
what the call does. Today the only defense is manual diligence: read the
contract, simulate the call, cross-check the price, and do it fast enough to
matter. Most users sign without any of that.

**Who it helps.** Anyone who mints or claims on BSC — and especially AI-agent
users, whose agents execute transactions on their behalf. If an agent can
spend your money, the check before the signature is the most valuable thing
in the loop.

**What it does.** MintGuard is a read-only wallet & transaction guard agent.
You send it the contract, your wallet, and the call you are about to sign;
it checks the contract on-chain (code, source verification, pause state,
price, supply) and simulates your exact call, then answers SAFE / CAUTION /
BLOCKED with the evidence behind the verdict. It never signs, never holds
keys, never sends a transaction.

---

## BUILD CONTEXT

**How it works.** A single-file Cloudflare Worker, zero dependencies, one
paste to deploy. `POST /verify` runs six checks — contractExists
(`eth_getCode`, with a view-call probe for the BSC empty-code RPC quirk),
sourceVerified (Sourcify v2), notPaused (`paused()`), priceDiscovery (seven
no-arg price getters, first answer wins), freeSupply (best effort), and
simulation (`eth_call` with your wallet, calldata, and value; revert reasons
decoded). `POST /quote` runs the first five only — the "is it really free?"
check. `GET /` is a demo form; `GET /health` reports chain + live RPC.

**Key decisions.** (1) Single file, zero deps — the smallest thing that can
be a real public endpoint. (2) Vendored keccak256 + a minimal ABI codec:
WebCrypto has no keccak, and selectors/encoding are required for any of this
to work; both are verified against known test vectors. (3) Public RPCs with
fallback + retry (`bsc.publicnode.com`, then `1rpc.io/bnb`); a revert is a
result, never retried. (4) "Unknown is not fail": a missing `paused()` or
price getter means "could not determine", not "bad" — only hard facts (no
code, paused, revert, price mismatch) block. (5) Read-only by construction:
no signing code exists anywhere in the file.

**What it cannot do (v1).** BSC only; no-arg price getters only; no approval
/ allowance check; public-RPC rate limits apply; a passing simulation proves
the call works at the simulated block, not forever. All of this is stated in
the README.

**Test evidence.** `node test-verify.mjs` (plain node, no deps) — 34/34 pass
against real BSC contracts, recorded in `demo.md`: DYOR `mint()` value 0
reverts on-chain → BLOCKED; PoA `PRICE()` = 0.0015 BNB → not free; BOBBIE
`paused()` = false; a dead address → BLOCKED. The suite also caught and fixed
a real bug (a double-`0x` prefix that made view calls return empty data).

---

## ZKVERIFY (optional)

zkVerify is **not integrated** — no proof is generated and none is claimed.

Today MintGuard verifies by re-reading: every value the verdict relies on
(code, price, pause state, simulation result) comes from a public on-chain
read anyone can repeat. The verdict is transparent, but it is still the
agent's word.

The checkable claim for a future integration is: *"the price and supply
values this verdict relied on are the values the chain returned"* — provable
by turning the RPC responses the verdict relied on into a zkVerify-checkable
claim (via zkTLS over the RPC responses), so a verdict would arrive with a
proof instead of a promise. That is the next step, not the current state.
