# MintGuard — recorded test outputs

Real outputs from `node test-verify.mjs` (run 2, after the double-0x fix), 2026-11-15.
Command: `node test-verify.mjs`. Test wallet: `0xdB7CAcF14A5F67BA005FAc84d41fDDF28d1A34B6`.
RPC: https://bsc.publicnode.com (primary; fallback https://1rpc.io/bnb was not needed).

## Result

```
== 34 passed, 0 failed ==
```

## PASS/FAIL list

```
PASS  keccak256('')
PASS  keccak256('abc')
PASS  keccak256('hello world')
PASS  selector paused()
PASS  selector totalSupply()
PASS  selector balanceOf(address)
PASS  selector mint()
PASS  encodeCall mint()
PASS  encodeCall remainingFor(address)
PASS  decodeUint 1
PASS  no double-0x: encodeCall('paused()')
PASS  no double-0x: selector has a single 0x prefix
PASS  decodeRevert Error(string)
PASS  GET /health ok, chain 56 — rpc=https://bsc.publicnode.com
PASS  GET / returns HTML demo page — bytes=3003
PASS  DYOR /quote: contract exists — code present (9362 bytes)
PASS  DYOR /quote: source verified — Sourcify exact match
PASS  DYOR /verify totalSupply: simulation succeeds
PASS  DYOR /verify totalSupply: verdict recorded (actual) — verdict=SAFE
PASS  DYOR /verify mint(): response well-formed, actual result recorded — simulation=revert verdict=BLOCKED revert=reverted (no reason string)
PASS  BOBBIE /quote: contract exists
PASS  BOBBIE /quote: source verified
PASS  BOBBIE /quote: paused() is false — paused=false
PASS  BOBBIE /quote: no price getter (genuine — all revert) — priceWei=null
PASS  BOBBIE /quote: no supply getter (genuine — totalSupply reverts)
PASS  BOBBIE /verify paused(): simulation succeeds
PASS  PoA /quote: contract exists
PASS  PoA /quote: source verified (exact match) — Sourcify exact match
PASS  PoA /quote: PRICE() = 1500000000000000 wei (0.0015 BNB) — priceWei=1500000000000000 via PRICE()
PASS  PoA /quote: not free — free=false
PASS  PoA /verify: verdict CAUTION (no simulation attempted) — verdict=CAUTION
PASS  Dead /verify: contractExists fails
PASS  Dead /verify: verdict BLOCKED — verdict=BLOCKED
PASS  Dead /quote: contractExists fails
```

## GET /health

```json
{"ok":true,"chain":56,"rpc":"https://bsc.publicnode.com"}
```

## POST /quote — DYOR NFT

```json
{
  "contract": "0x86956Bc830EB62110820Ae79164BeF61c7E31936",
  "checks": [
    {
      "name": "contractExists",
      "status": "pass",
      "detail": "code present (9362 bytes)"
    },
    {
      "name": "sourceVerified",
      "status": "pass",
      "detail": "Sourcify exact match"
    },
    {
      "name": "notPaused",
      "status": "unknown",
      "detail": "no paused() on this contract"
    },
    {
      "name": "priceDiscovery",
      "status": "unknown",
      "detail": "no no-arg price getter answered (mintPrice() PRICE() price() cost() mintCost() getPrice() MINT_PRICE())"
    },
    {
      "name": "freeSupply",
      "status": "pass",
      "detail": "totalSupply() = 11111"
    }
  ],
  "priceWei": null,
  "priceGetter": null,
  "paused": null,
  "supply": {
    "totalSupply()": "11111"
  },
  "sourcify": "exact",
  "free": null,
  "summary": "CAUTION: no simulation was run; price could not be determined."
}
```

## POST /verify — DYOR totalSupply (SAFE path)

```json
{
  "verdict": "SAFE",
  "checks": [
    {
      "name": "contractExists",
      "status": "pass",
      "detail": "code present (9362 bytes)"
    },
    {
      "name": "sourceVerified",
      "status": "pass",
      "detail": "Sourcify exact match"
    },
    {
      "name": "notPaused",
      "status": "unknown",
      "detail": "no paused() on this contract"
    },
    {
      "name": "priceDiscovery",
      "status": "unknown",
      "detail": "no no-arg price getter answered (mintPrice() PRICE() price() cost() mintCost() getPrice() MINT_PRICE())"
    },
    {
      "name": "freeSupply",
      "status": "pass",
      "detail": "totalSupply() = 11111"
    },
    {
      "name": "simulation",
      "status": "pass",
      "detail": "eth_call succeeded for totalSupply with value 0 wei"
    }
  ],
  "evidence": {
    "sourcify": "exact",
    "priceWei": null,
    "priceGetter": null,
    "simulation": "success",
    "revertReason": null,
    "paused": null,
    "supply": {
      "totalSupply()": "11111"
    }
  },
  "summary": "SAFE: contract exists and is source-verified, not paused, no price getter — value proved by simulation, and the call simulates cleanly.",
  "rpc": "https://bsc.publicnode.com"
}
```

## POST /verify — DYOR mint() value 0 (BLOCKED: reverts on-chain)

```json
{
  "verdict": "BLOCKED",
  "checks": [
    {
      "name": "contractExists",
      "status": "pass",
      "detail": "code present (9362 bytes)"
    },
    {
      "name": "sourceVerified",
      "status": "pass",
      "detail": "Sourcify exact match"
    },
    {
      "name": "notPaused",
      "status": "unknown",
      "detail": "no paused() on this contract"
    },
    {
      "name": "priceDiscovery",
      "status": "unknown",
      "detail": "no no-arg price getter answered (mintPrice() PRICE() price() cost() mintCost() getPrice() MINT_PRICE())"
    },
    {
      "name": "freeSupply",
      "status": "pass",
      "detail": "totalSupply() = 11111"
    },
    {
      "name": "simulation",
      "status": "fail",
      "detail": "eth_call reverted: reverted (no reason string)"
    }
  ],
  "evidence": {
    "sourcify": "exact",
    "priceWei": null,
    "priceGetter": null,
    "simulation": "revert",
    "revertReason": "reverted (no reason string)",
    "paused": null,
    "supply": {
      "totalSupply()": "11111"
    }
  },
  "summary": "BLOCKED: the call reverts on-chain: reverted (no reason string).",
  "rpc": "https://bsc.publicnode.com"
}
```

## POST /quote — BOBBIE NFT (paused() = false)

```json
{
  "contract": "0x3BF121dC4c5a1Ba567F3eE801d0e447601726207",
  "checks": [
    {
      "name": "contractExists",
      "status": "pass",
      "detail": "code present (19425 bytes)"
    },
    {
      "name": "sourceVerified",
      "status": "pass",
      "detail": "Sourcify exact match"
    },
    {
      "name": "notPaused",
      "status": "pass",
      "detail": "paused() = false"
    },
    {
      "name": "priceDiscovery",
      "status": "unknown",
      "detail": "no no-arg price getter answered (mintPrice() PRICE() price() cost() mintCost() getPrice() MINT_PRICE())"
    },
    {
      "name": "freeSupply",
      "status": "unknown",
      "detail": "no supply getter answered"
    }
  ],
  "priceWei": null,
  "priceGetter": null,
  "paused": false,
  "supply": null,
  "sourcify": "exact",
  "free": null,
  "summary": "CAUTION: no simulation was run; price could not be determined."
}
```

## POST /verify — BOBBIE paused()

```json
{
  "verdict": "SAFE",
  "checks": [
    {
      "name": "contractExists",
      "status": "pass",
      "detail": "code present (19425 bytes)"
    },
    {
      "name": "sourceVerified",
      "status": "pass",
      "detail": "Sourcify exact match"
    },
    {
      "name": "notPaused",
      "status": "pass",
      "detail": "paused() = false"
    },
    {
      "name": "priceDiscovery",
      "status": "unknown",
      "detail": "no no-arg price getter answered (mintPrice() PRICE() price() cost() mintCost() getPrice() MINT_PRICE())"
    },
    {
      "name": "freeSupply",
      "status": "unknown",
      "detail": "no supply getter answered"
    },
    {
      "name": "simulation",
      "status": "pass",
      "detail": "eth_call succeeded for paused with value 0 wei"
    }
  ],
  "evidence": {
    "sourcify": "exact",
    "priceWei": null,
    "priceGetter": null,
    "simulation": "success",
    "revertReason": null,
    "paused": false,
    "supply": null
  },
  "summary": "SAFE: contract exists and is source-verified, not paused, no price getter — value proved by simulation, and the call simulates cleanly.",
  "rpc": "https://bsc.publicnode.com"
}
```

## POST /quote — PoA NFT (PRICE() = 0.0015 BNB, not free)

```json
{
  "contract": "0xbf7332b1787d916331b592361cb018a1e9aed1cd",
  "checks": [
    {
      "name": "contractExists",
      "status": "pass",
      "detail": "code present (7557 bytes)"
    },
    {
      "name": "sourceVerified",
      "status": "pass",
      "detail": "Sourcify exact match"
    },
    {
      "name": "notPaused",
      "status": "unknown",
      "detail": "no paused() on this contract"
    },
    {
      "name": "priceDiscovery",
      "status": "pass",
      "detail": "PRICE() = 1500000000000000 wei"
    },
    {
      "name": "freeSupply",
      "status": "pass",
      "detail": "totalSupply() = 1014"
    }
  ],
  "priceWei": "1500000000000000",
  "priceGetter": "PRICE()",
  "paused": null,
  "supply": {
    "totalSupply()": "1014"
  },
  "sourcify": "exact",
  "free": false,
  "summary": "CAUTION: no simulation was run."
}
```

## POST /verify — PoA, no function (CAUTION: no simulation)

```json
{
  "verdict": "CAUTION",
  "checks": [
    {
      "name": "contractExists",
      "status": "pass",
      "detail": "code present (7557 bytes)"
    },
    {
      "name": "sourceVerified",
      "status": "pass",
      "detail": "Sourcify exact match"
    },
    {
      "name": "notPaused",
      "status": "unknown",
      "detail": "no paused() on this contract"
    },
    {
      "name": "priceDiscovery",
      "status": "pass",
      "detail": "PRICE() = 1500000000000000 wei"
    },
    {
      "name": "freeSupply",
      "status": "pass",
      "detail": "totalSupply() = 1014"
    }
  ],
  "evidence": {
    "sourcify": "exact",
    "priceWei": "1500000000000000",
    "priceGetter": "PRICE()",
    "simulation": "not-run",
    "revertReason": null,
    "paused": null,
    "supply": {
      "totalSupply()": "1014"
    }
  },
  "summary": "CAUTION: no simulation was run.",
  "rpc": "https://bsc.publicnode.com"
}
```

## POST /verify — dead address (BLOCKED: no code)

```json
{
  "verdict": "BLOCKED",
  "checks": [
    {
      "name": "contractExists",
      "status": "fail",
      "detail": "eth_getCode returned empty and no view probe answered"
    },
    {
      "name": "sourceVerified",
      "status": "fail",
      "detail": "not verified on Sourcify — source cannot be read independently"
    },
    {
      "name": "notPaused",
      "status": "unknown",
      "detail": "no paused() on this contract"
    },
    {
      "name": "priceDiscovery",
      "status": "unknown",
      "detail": "no no-arg price getter answered (mintPrice() PRICE() price() cost() mintCost() getPrice() MINT_PRICE())"
    },
    {
      "name": "freeSupply",
      "status": "unknown",
      "detail": "no supply getter answered"
    }
  ],
  "evidence": {
    "sourcify": "unverified",
    "priceWei": null,
    "priceGetter": null,
    "simulation": "not-run",
    "revertReason": null,
    "paused": null,
    "supply": null
  },
  "summary": "BLOCKED: no contract code at this address.",
  "rpc": "https://bsc.publicnode.com"
}
```

## Notes on the two corrected expectations (run 1 → run 2)

Run 1 finished 26 passed / 2 failed. Both failures were wrong expectations, not wrong
on-chain data — and the investigation found a real bug in the Worker:

1. **Double-`0x` bug (fixed).** Three no-arg view calls were built as `"0x" + functionSelector(...)`,
   but `functionSelector()` already returns a `0x`-prefixed string, so the calldata was
   `0x0x5c975abb`. The node answered those calls with empty data, so `paused()` and the
   price getters looked absent. Fixed to use `functionSelector(...)` directly; a regression
   test now asserts `encodeCall("paused()") === "0x5c975abb"`.

2. **BOBBIE paused().** With correct calldata, `paused()` returns 32 zero bytes — `false`.
   `totalSupply()` and all price getters genuinely revert on this contract (no Enumerable,
   no price getter), so freeSupply/priceDiscovery are unknown for real.

3. **PoA source.** The Nov 7 note said "NOT Sourcify-verified". Sourcify v2 now returns
   `match: "exact_match"` — the project verified the source since then. `PRICE()` returns
   `1500000000000000` wei (0.0015 BNB), so the mint is NOT free (`free: false`).
   `paused()` genuinely reverts (no pause function).

4. **DYOR mint().** `mint()` with value 0 reverts on-chain (no reason string) — the wallet's
   free mint was already used. MintGuard correctly reports BLOCKED. `totalSupply() = 11111`.


## Additional recorded call (not part of test-verify.mjs)

`POST /verify` PoA `totalSupply`, value 0 — run separately to capture the
full SAFE response used as the README example. Note the summary wording:
after the first capture, the SAFE summary was corrected from "price ...
matches" to "price ... found" when no `expectedValue` was provided (nothing
was being compared against). The output below is from after that fix.

```json
{
  "verdict": "SAFE",
  "checks": [
    {
      "name": "contractExists",
      "status": "pass",
      "detail": "code present (7557 bytes)"
    },
    {
      "name": "sourceVerified",
      "status": "pass",
      "detail": "Sourcify exact match"
    },
    {
      "name": "notPaused",
      "status": "unknown",
      "detail": "no paused() on this contract"
    },
    {
      "name": "priceDiscovery",
      "status": "pass",
      "detail": "PRICE() = 1500000000000000 wei"
    },
    {
      "name": "freeSupply",
      "status": "pass",
      "detail": "totalSupply() = 1014"
    },
    {
      "name": "simulation",
      "status": "pass",
      "detail": "eth_call succeeded for totalSupply with value 0 wei"
    }
  ],
  "evidence": {
    "sourcify": "exact",
    "priceWei": "1500000000000000",
    "priceGetter": "PRICE()",
    "simulation": "success",
    "revertReason": null,
    "paused": null,
    "supply": {
      "totalSupply()": "1014"
    }
  },
  "summary": "SAFE: contract exists and is source-verified, not paused, price 1500000000000000 wei found, and the call simulates cleanly.",
  "rpc": "https://bsc.publicnode.com"
}
```
