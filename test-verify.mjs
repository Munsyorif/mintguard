// MintGuard test script — plain node, no deps.
// Imports the SAME worker.js that gets deployed and calls its fetch handler
// directly (no server needed). Runs offline keccak checks first, then live
// on-chain checks against real BSC contracts via the Worker's own RPC layer.
// Usage: node test-verify.mjs   (exit 0 = all expectations met)
//
// Test wallet / contracts come from real past work — never invent addresses:
//   wallet: 0xdB7CAcF14A5F67BA005FAc84d41fDDF28d1A34B6 (the user's BSC wallet)
//   DYOR NFT   0x86956Bc830EB62110820Ae79164BeF61c7E31936 (Sourcify exact match)
//   BOBBIE NFT 0x3BF121dC4c5a1Ba567F3eE801d0e447601726207 (Sourcify exact match;
//             paused() returns false; no totalSupply, no price getter)
//   PoA NFT    0xbf7332b1787d916331b592361cb018a1e9aed1cd (Sourcify exact_match
//             since the Nov 7 check; PRICE() = 1500000000000000 wei = 0.0015 BNB)
//   dead addr  0x1111111111111111111111111111111111111111 (no code)

import worker, {
  keccak256,
  functionSelector,
  encodeCall,
  decodeUint,
  decodeRevertReason,
} from "./worker.js";

const WALLET = "0xdB7CAcF14A5F67BA005FAc84d41fDDF28d1A34B6";
const DYOR = "0x86956Bc830EB62110820Ae79164BeF61c7E31936";
const BOBBIE = "0x3BF121dC4c5a1Ba567F3eE801d0e447601726207";
const POA = "0xbf7332b1787d916331b592361cb018a1e9aed1cd";
const DEAD = "0x1111111111111111111111111111111111111111";

const hex = (b) => "0x" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
let pass = 0;
let fail = 0;
const results = [];

function report(name, ok, detail) {
  results.push({ name, ok, detail });
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callWorker(method, path, body) {
  const res = await worker.fetch(
    new Request("http://localhost" + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
  );
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep raw text */ }
  return { status: res.status, json, text };
}
const checkStatus = (checks, name) => {
  const c = (checks || []).find((x) => x.name === name);
  return c ? c.status : "missing";
};
const checkDetail = (checks, name) => {
  const c = (checks || []).find((x) => x.name === name);
  return c ? c.detail : "";
};

console.log("== MintGuard tests ==\n-- 1. keccak / ABI (offline, no network) --");
report("keccak256('')", hex(keccak256("")) === "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
report("keccak256('abc')", hex(keccak256("abc")) === "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
report("keccak256('hello world')", hex(keccak256("hello world")) === "0x47173285a8d7341e5e972fc677286384f802f8ef42a5ec5f03bbfa254cb01fad");
report("selector paused()", functionSelector("paused()") === "0x5c975abb");
report("selector totalSupply()", functionSelector("totalSupply()") === "0x18160ddd");
report("selector balanceOf(address)", functionSelector("balanceOf(address)") === "0x70a08231");
report("selector mint()", functionSelector("mint()") === "0x1249c58b");
report("encodeCall mint()", encodeCall("mint()") === "0x1249c58b");
report("encodeCall remainingFor(address)", encodeCall("remainingFor(address)", [WALLET]) ===
  "0x24c0c499000000000000000000000000db7cacf14a5f67ba005fac84d41fddf28d1a34b6");
report("decodeUint 1", decodeUint("0x0000000000000000000000000000000000000000000000000000000000000001") === "1");
report("no double-0x: encodeCall('paused()')", encodeCall("paused()") === "0x5c975abb");
report("no double-0x: selector has a single 0x prefix", /^0x[0-9a-f]{8}$/.test(functionSelector("paused()")));
// "Insufficient payment" = 20 bytes (0x14), Error(string) encoding:
report("decodeRevert Error(string)",
  decodeRevertReason("0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000014496e73756666696369656e74207061796d656e7400000000000000000000000000") ===
    "Insufficient payment");

console.log("\n-- 2. HTTP surface (live, via worker.fetch) --");
{
  const r = await callWorker("GET", "/health");
  console.log("   /health ->", JSON.stringify(r.json));
  report("GET /health ok, chain 56", r.status === 200 && r.json && r.json.ok === true && r.json.chain === 56,
    r.json ? "rpc=" + r.json.rpc : "status=" + r.status);
  await sleep(500);
  const h = await callWorker("GET", "/");
  report("GET / returns HTML demo page", h.status === 200 && h.text.includes("MintGuard") && h.text.includes("Verify"),
    "bytes=" + h.text.length);
}

console.log("\n-- 3. DYOR NFT (verified, real mint contract) --");
{
  const r = await callWorker("POST", "/quote", { contract: DYOR, wallet: WALLET });
  console.log("   /quote DYOR ->", JSON.stringify(r.json, null, 2));
  report("DYOR /quote: contract exists", checkStatus(r.json?.checks, "contractExists") === "pass", checkDetail(r.json?.checks, "contractExists"));
  report("DYOR /quote: source verified", checkStatus(r.json?.checks, "sourceVerified") === "pass", checkDetail(r.json?.checks, "sourceVerified"));
  console.log("   DYOR price:", r.json?.priceWei, "via", r.json?.priceGetter, "| supply:", JSON.stringify(r.json?.supply), "| paused:", r.json?.paused);
  await sleep(500);

  // Simulation of a view call (must succeed) — the deterministic sim-success path.
  const v = await callWorker("POST", "/verify", { contract: DYOR, wallet: WALLET, function: "totalSupply", args: [], value: "0" });
  console.log("   /verify DYOR totalSupply ->", JSON.stringify(v.json, null, 2));
  report("DYOR /verify totalSupply: simulation succeeds", v.json?.evidence?.simulation === "success");
  report("DYOR /verify totalSupply: verdict recorded (actual)", !!v.json?.verdict, "verdict=" + v.json?.verdict);
  await sleep(500);

  // The real mint() call — record what the chain actually says. The wallet's
  // free mint #1 was already used, so this may revert; do NOT force an outcome.
  const m = await callWorker("POST", "/verify", { contract: DYOR, wallet: WALLET, function: "mint", args: [], value: "0" });
  console.log("   /verify DYOR mint() value 0 ->", JSON.stringify(m.json, null, 2));
  report("DYOR /verify mint(): response well-formed, actual result recorded", !!m.json?.verdict,
    `simulation=${m.json?.evidence?.simulation} verdict=${m.json?.verdict} revert=${m.json?.evidence?.revertReason}`);
}

console.log("\n-- 4. BOBBIE NFT (verified; paused() returns false) --");
// Direct-probe verified 2026-11-15: paused() returns 32 zero bytes (false).
// totalSupply()/PRICE()/price()/mintPrice() genuinely revert (no Enumerable,
// no price getter) — freeSupply and priceDiscovery are unknown for real.
{
  const r = await callWorker("POST", "/quote", { contract: BOBBIE, wallet: WALLET });
  console.log("   /quote BOBBIE ->", JSON.stringify(r.json, null, 2));
  report("BOBBIE /quote: contract exists", checkStatus(r.json?.checks, "contractExists") === "pass");
  report("BOBBIE /quote: source verified", checkStatus(r.json?.checks, "sourceVerified") === "pass");
  report("BOBBIE /quote: paused() is false", r.json?.paused === false, "paused=" + r.json?.paused);
  report("BOBBIE /quote: no price getter (genuine — all revert)", r.json?.priceWei === null, "priceWei=" + r.json?.priceWei);
  report("BOBBIE /quote: no supply getter (genuine — totalSupply reverts)", r.json?.supply === null);
  console.log("   BOBBIE price:", r.json?.priceWei, "via", r.json?.priceGetter, "| supply:", JSON.stringify(r.json?.supply));
  await sleep(500);

  const v = await callWorker("POST", "/verify", { contract: BOBBIE, wallet: WALLET, function: "paused", args: [], value: "0" });
  console.log("   /verify BOBBIE paused() ->", JSON.stringify(v.json, null, 2));
  report("BOBBIE /verify paused(): simulation succeeds", v.json?.evidence?.simulation === "success");
}

console.log("\n-- 5. PoA NFT (Sourcify-verified since the Nov 7 check; PRICE() = 0.0015 BNB) --");
// Direct-probe verified 2026-11-15: Sourcify v2 returns match "exact_match"
// (the Nov 7 "NOT verified" note is stale — the project verified the source
// since). PRICE() returns 0x05543df729c000 = 1500000000000000 wei (0.0015 BNB).
// paused() genuinely reverts (no pause function). /verify with no function
// is CAUTION because no simulation was attempted — not because of the source.
{
  const r = await callWorker("POST", "/quote", { contract: POA, wallet: WALLET });
  console.log("   /quote PoA ->", JSON.stringify(r.json, null, 2));
  report("PoA /quote: contract exists", checkStatus(r.json?.checks, "contractExists") === "pass");
  report("PoA /quote: source verified (exact match)", checkStatus(r.json?.checks, "sourceVerified") === "pass",
    checkDetail(r.json?.checks, "sourceVerified"));
  report("PoA /quote: PRICE() = 1500000000000000 wei (0.0015 BNB)",
    r.json?.priceWei === "1500000000000000" && r.json?.priceGetter === "PRICE()",
    `priceWei=${r.json?.priceWei} via ${r.json?.priceGetter}`);
  report("PoA /quote: not free", r.json?.free === false, "free=" + r.json?.free);
  console.log("   PoA price:", r.json?.priceWei, "via", r.json?.priceGetter, "| supply:", JSON.stringify(r.json?.supply), "| paused:", r.json?.paused);
  await sleep(500);

  const v = await callWorker("POST", "/verify", { contract: POA, wallet: WALLET });
  console.log("   /verify PoA (no function) ->", JSON.stringify(v.json, null, 2));
  report("PoA /verify: verdict CAUTION (no simulation attempted)", v.json?.verdict === "CAUTION", "verdict=" + v.json?.verdict);
}

console.log("\n-- 6. Dead address (no code -> BLOCKED) --");
{
  const v = await callWorker("POST", "/verify", { contract: DEAD, wallet: WALLET });
  console.log("   /verify dead ->", JSON.stringify(v.json, null, 2));
  report("Dead /verify: contractExists fails", checkStatus(v.json?.checks, "contractExists") === "fail");
  report("Dead /verify: verdict BLOCKED", v.json?.verdict === "BLOCKED", "verdict=" + v.json?.verdict);
  await sleep(500);

  const q = await callWorker("POST", "/quote", { contract: DEAD, wallet: WALLET });
  console.log("   /quote dead ->", JSON.stringify(q.json, null, 2));
  report("Dead /quote: contractExists fails", checkStatus(q.json?.checks, "contractExists") === "fail");
}

console.log(`\n== ${pass} passed, ${fail} failed ==`);
process.exit(fail ? 1 : 0);
