// ============================================================================
// MintGuard — read-only BSC mint/claim verification agent
// Cloudflare Worker, single file, ZERO dependencies.
// Paste this file into the Cloudflare dashboard (Workers & Pages -> Create
// Worker -> paste -> Deploy). No wrangler.toml, no build step, no secrets.
//
// What it does: before a user signs a mint/claim transaction, MintGuard
// checks the contract on-chain and returns a verdict:
//   SAFE    — the call looks fine (see verdict rules in runChecks/decideVerdict)
//   CAUTION — something could not be verified, or a soft risk was found
//   BLOCKED — the call would fail, is paused, is not free when it should be,
//             or there is no contract at the address
//
// It is READ-ONLY: it never signs, never holds keys, never sends a
// transaction. All it does is eth_getCode / eth_call against public BSC
// RPCs and a source lookup on Sourcify. BSC chain 56 only (v1).
//
// Endpoints (all JSON, CORS open):
//   GET  /        — agent info + a small HTML demo page
//   GET  /health  — {"ok":true,"chain":56,"rpc":"<which rpc answered>"}
//   POST /verify  — full check incl. simulation; returns verdict + checks
//   POST /quote   — checks 1-5 only (no simulation); "is it really free?"
//
// No secrets, no API keys anywhere in this file.
// ============================================================================

const CHAIN_ID = 56;
const RPCS = [
  "https://bsc.publicnode.com", // primary
  "https://1rpc.io/bnb",        // fallback
];
const SOURCIFY = "https://sourcify.dev/server/v2/contract/56";
const UA = "MintGuard/1.0 (Agent Games Wildcard; read-only verification agent)";

// No-arg price getters, tried in this order. The first that answers wins.
const PRICE_GETTERS = [
  "mintPrice()",
  "PRICE()",
  "price()",
  "cost()",
  "mintCost()",
  "getPrice()",
  "MINT_PRICE()",
];

// Best-effort supply info. remainingFor takes the wallet; the rest are no-arg.
// None of these is allowed to fail the verdict on its own (see check 5).
const SUPPLY_GETTERS = [
  { sig: "remainingFor(address)", args: (wallet) => [wallet] },
  { sig: "freeSupply()", args: () => [] },
  { sig: "remainingSupply()", args: () => [] },
  { sig: "totalSupply()", args: () => [] },
  { sig: "maxSupply()", args: () => [] },
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(s || "");
const concatBytes = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
};
const hexToBytes = (hex) => {
  hex = String(hex || "").replace(/^0x/, "");
  if (hex.length % 2) hex = "0" + hex;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const bytesToHex = (bytes) => "0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

// ---------------------------------------------------------------------------
// keccak256 (pure JS, BigInt lanes) — WebCrypto has no keccak, so we vendor it.
// Keccak-f[1600], 24 rounds, rate 136 bytes, pad10*1 with 0x01 (Keccak, NOT
// NIST SHA-3 which uses 0x06). Verified against known vectors (see test file):
//   keccak256("")    = c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
//   keccak256("abc") = 4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45
//   selector("paused()") = 0x5c975abb, "totalSupply()" = 0x18160ddd,
//   "balanceOf(address)" = 0x70a08231
// ---------------------------------------------------------------------------
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
  0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];
const MASK64 = (1n << 64n) - 1n;
const rotl64 = (x, n) => {
  const s = BigInt(n % 64);
  return s === 0n ? x & MASK64 : ((x << s) | (x >> (64n - s))) & MASK64;
};

function keccakF(state) {
  for (let round = 0; round < 24; round++) {
    // Theta
    const C = [];
    for (let x = 0; x < 5; x++)
      C[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    const D = [];
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) state[x + 5 * y] ^= D[x];
    // Rho + Pi
    const B = new Array(25);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(state[x + 5 * y], ROT[x][y]);
    // Chi
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        state[x + 5 * y] =
          B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y] & MASK64) & B[(x + 2) % 5 + 5 * y]);
    // Iota
    state[0] ^= RC[round];
  }
}

export function keccak256(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const rate = 136;
  const state = new Array(25).fill(0n);
  let off = 0;
  while (off + rate <= data.length) {
    for (let i = 0; i < rate; i++)
      state[(i / 8) | 0] ^= BigInt(data[off + i]) << BigInt(8 * (i % 8));
    keccakF(state);
    off += rate;
  }
  const block = new Uint8Array(rate);
  block.set(data.subarray(off));
  block[data.length - off] = 0x01; // keccak padding (0x01, not SHA-3's 0x06)
  block[rate - 1] |= 0x80;
  for (let i = 0; i < rate; i++)
    state[(i / 8) | 0] ^= BigInt(block[i]) << BigInt(8 * (i % 8));
  keccakF(state);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++)
    out[i] = Number((state[(i / 8) | 0] >> BigInt(8 * (i % 8))) & 0xffn);
  return out;
}

// ---------------------------------------------------------------------------
// Minimal ABI: function selectors, encoding, decoding.
// Supported types: address, uint/int (any width, treated as uint256),
// bool, bytes32, bytesN, string, bytes, and arrays of those (T[] and T[k]).
// ---------------------------------------------------------------------------
export function functionSelector(signature) {
  return bytesToHex(keccak256(signature).slice(0, 4));
}

function parseFunction(fn) {
  const m = String(fn).trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\((.*)\))?$/);
  if (!m) throw new Error("bad function: " + fn);
  const name = m[1];
  const types =
    m[2] == null || m[2].trim() === "" ? [] : m[2].split(",").map((s) => s.trim());
  return { name, types, signature: name + "(" + types.join(",") + ")" };
}

const isDynamicType = (t) => {
  if (t === "string" || t === "bytes" || t.endsWith("[]")) return true;
  const m = t.match(/^(.*)\[(\d+)\]$/);
  return m ? isDynamicType(m[1]) : false;
};

function encodeUint256(v) {
  const b = BigInt(v);
  if (b < 0n) throw new Error("negative uint: " + v);
  const out = new Uint8Array(32);
  let x = b;
  for (let i = 31; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}
function encodeStatic(type, value) {
  if (type === "address") {
    if (!isAddress(value)) throw new Error("bad address: " + value);
    const out = new Uint8Array(32);
    out.set(hexToBytes(value), 12);
    return out;
  }
  if (/^u?int(\d*)$/.test(type)) return encodeUint256(value);
  if (type === "bool") {
    const out = new Uint8Array(32);
    out[31] = value ? 1 : 0;
    return out;
  }
  if (type === "bytes32") {
    const b = hexToBytes(value);
    if (b.length !== 32) throw new Error("bytes32 must be 32 bytes");
    return b;
  }
  const bn = type.match(/^bytes(\d+)$/);
  if (bn) {
    const n = Number(bn[1]);
    if (n < 1 || n > 32) throw new Error("bad bytesN: " + type);
    const b = hexToBytes(value);
    if (b.length !== n) throw new Error(type + " must be " + n + " bytes");
    const out = new Uint8Array(32); // bytesN is left-aligned
    out.set(b, 0);
    return out;
  }
  throw new Error("unsupported static type: " + type);
}
function encodeBytesData(value) {
  const data = hexToBytes(value);
  const padded = new Uint8Array(Math.ceil(data.length / 32) * 32);
  padded.set(data);
  return concatBytes(encodeUint256(data.length), padded);
}
function encodeStringData(value) {
  const data = new TextEncoder().encode(String(value));
  const padded = new Uint8Array(Math.ceil(data.length / 32) * 32);
  padded.set(data);
  return concatBytes(encodeUint256(data.length), padded);
}
// Full encoding of one value (tail form for dynamic types, word for static).
function encodeData(type, value) {
  if (type === "string") return encodeStringData(value);
  if (type === "bytes") return encodeBytesData(value);
  const arr = type.match(/^(.*)\[(\d*)\]$/);
  if (arr) {
    const elem = arr[1];
    const fixed = arr[2] !== "";
    if (!Array.isArray(value)) throw new Error(type + " expects an array");
    const parts = [];
    if (!fixed) parts.push(encodeUint256(value.length));
    const tails = [];
    let offset = value.length * 32;
    for (const v of value) {
      if (isDynamicType(elem)) {
        parts.push(encodeUint256(offset));
        const enc = encodeData(elem, v);
        tails.push(enc);
        offset += enc.length;
      } else {
        parts.push(encodeData(elem, v));
      }
    }
    return concatBytes(...parts, ...tails);
  }
  return encodeStatic(type, value);
}

export function encodeCall(signature, args = []) {
  const { types, signature: sig } = parseFunction(signature);
  if (types.length !== args.length)
    throw new Error(`arg count mismatch for ${sig}: expected ${types.length}, got ${args.length}`);
  const heads = [];
  const tails = [];
  let tailOffset = types.length * 32;
  for (let i = 0; i < types.length; i++) {
    if (isDynamicType(types[i])) {
      heads.push(encodeUint256(tailOffset));
      const enc = encodeData(types[i], args[i]);
      tails.push(enc);
      tailOffset += enc.length;
    } else {
      heads.push(encodeData(types[i], args[i]));
    }
  }
  return bytesToHex(concatBytes(hexToBytes(functionSelector(sig)), ...heads, ...tails));
}

const uintFromBytes = (b) => {
  let x = 0n;
  for (const byte of b) x = (x << 8n) | BigInt(byte);
  return x;
};
export function decodeUint(data) {
  const b = hexToBytes(data);
  if (b.length < 32) return null;
  return uintFromBytes(b.slice(0, 32)).toString();
}
export function decodeBool(data) {
  const b = hexToBytes(data);
  return b.length >= 32 ? b[31] !== 0 : null;
}
export function decodeAddress(data) {
  const b = hexToBytes(data);
  return b.length >= 32 ? bytesToHex(b.slice(12, 32)) : null;
}
export function decodeString(data) {
  const b = hexToBytes(data);
  if (b.length < 64) return null;
  const len = Number(uintFromBytes(b.slice(32, 64)));
  if (b.length < 64 + len) return null;
  return new TextDecoder().decode(b.slice(64, 64 + len));
}
// Decode a revert: Error(string) = 0x08c379a0, Panic(uint256) = 0x4e487b71.
export function decodeRevertReason(data) {
  if (!data || typeof data !== "string") return null;
  const d = data.toLowerCase();
  if (d.startsWith("0x08c379a0")) {
    try {
      return decodeString("0x" + d.slice(10));
    } catch {
      return null;
    }
  }
  if (d.startsWith("0x4e487b71")) return "Panic(0x" + d.slice(10, 74) + ")";
  return null;
}

// ---------------------------------------------------------------------------
// RPC layer: public BSC RPCs with fallback + retry. A revert (code 3 or a
// "revert" message) is a RESULT, not a transport failure — it is returned,
// not retried. 429s / network errors are retried with backoff, then we fall
// back to the next RPC.
// ---------------------------------------------------------------------------
async function rpcJson(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ jsonrpc: "2.0", id: Math.floor(Math.random() * 100000), method, params }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const e = new Error("HTTP " + res.status + " from " + url);
    e.httpStatus = res.status;
    throw e;
  }
  return res.json();
}

async function rpcCall(method, params) {
  let lastErr = null;
  for (const url of RPCS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const j = await rpcJson(url, method, params);
        if (j.error) {
          const err = new Error(j.error.message || "RPC error");
          err.code = j.error.code;
          err.data = j.error.data;
          err.isRpcError = true;
          throw err;
        }
        return { result: j.result, rpc: url };
      } catch (e) {
        lastErr = e;
        if (e.isRpcError && (e.code === 3 || /revert/i.test(e.message || ""))) {
          // Execution revert: deterministic, return it — do not retry.
          return { reverted: true, data: e.data || null, message: e.message, rpc: url };
        }
        await sleep(400 * (attempt + 1));
      }
    }
  }
  throw lastErr;
}

// eth_call wrapper. Returns {status:"ok", data, rpc} or
// {status:"revert", data, message, rpc}. Throws only on transport failure
// after all retries + fallbacks.
async function ethCallRaw({ from, to, data, value }) {
  const params = [{ from, to, data, value: value || "0x0" }, "latest"];
  const r = await rpcCall("eth_call", params);
  if (r.reverted) return { status: "revert", data: r.data, message: r.message, rpc: r.rpc };
  return { status: "ok", data: r.result, rpc: r.rpc };
}

// ---------------------------------------------------------------------------
// Sourcify v2: 200 = verified (match "exact" or "partial"), 404 = unverified,
// anything else / network error = unknown.
// ---------------------------------------------------------------------------
async function checkSourcify(address) {
  try {
    const res = await fetch(`${SOURCIFY}/${address}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 200) {
      const j = await res.json().catch(() => ({}));
      // v2 returns match: "exact_match" | "partial_match" (older docs: "exact" | "partial")
      if (typeof j.match === "string" && j.match.startsWith("partial")) return "partial";
      return "exact"; // 200 means verified; match field absent -> treat as exact
    }
    if (res.status === 404) return "unverified";
    return "unknown";
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Check pipeline + verdict
// Each check is {name, status: "pass"|"fail"|"unknown", detail}.
// Verdict rules (implemented in decideVerdict, documented here so the rule
// is auditable from the code):
//   BLOCKED if: no contract code, OR paused() == true, OR the simulation
//     reverts, OR a discovered price != expectedValue (when expectedValue
//     was provided).
//   CAUTION if: source unverified, OR no simulation was attempted
//     (no function/calldata given), OR the price could not be determined
//     AND the simulation did not succeed, OR paused() is unknown AND NOT
//     (source verified AND simulation succeeded).
//   SAFE only if: contract exists + source verified + not paused
//     (paused unknown is OK only when source is verified AND the simulation
//     succeeded) + simulation succeeds + price check passed, where the
//     price check passes when (price found AND == expectedValue) OR
//     (no price getter found BUT the simulation with the provided value
//     succeeded — the chain itself just proved the value works).
// Supply info is informational only: it never fails the verdict on its own.
// ---------------------------------------------------------------------------
function decideVerdict({ exists, sourcify, paused, priceWei, expectedValue, sim }) {
  const sourceVerified = sourcify === "exact" || sourcify === "partial";
  if (exists === false) return "BLOCKED";
  if (paused === true) return "BLOCKED";
  if (sim === "revert") return "BLOCKED";
  if (
    expectedValue != null &&
    expectedValue !== "" &&
    priceWei != null &&
    BigInt(priceWei) !== BigInt(expectedValue)
  )
    return "BLOCKED";
  if (exists !== true) return "CAUTION";
  if (!sourceVerified) return "CAUTION";
  if (sim === "not-run") return "CAUTION";
  if (priceWei == null && sim !== "success") return "CAUTION";
  if (paused === null && !(sourceVerified && sim === "success")) return "CAUTION";
  return "SAFE";
}

function buildSummary(verdict, f) {
  if (verdict === "BLOCKED") {
    if (f.exists === false) return "BLOCKED: no contract code at this address.";
    if (f.paused === true) return "BLOCKED: the contract is paused — minting is disabled.";
    if (f.sim === "revert")
      return "BLOCKED: the call reverts on-chain" + (f.revertReason ? `: ${f.revertReason}.` : ".");
    if (f.expectedValue != null && f.priceWei != null)
      return `BLOCKED: on-chain price is ${f.priceWei} wei but the expected value is ${f.expectedValue} wei.`;
    return "BLOCKED: a hard check failed.";
  }
  if (verdict === "CAUTION") {
    const reasons = [];
    if (!(f.sourcify === "exact" || f.sourcify === "partial"))
      reasons.push("source is not verified on Sourcify");
    if (f.sim === "not-run") reasons.push("no simulation was run");
    if (f.priceWei == null && f.sim !== "success") reasons.push("price could not be determined");
    if (f.paused === null && !(f.sourcify === "exact" || f.sourcify === "partial"))
      reasons.push("pause state unknown");
    return "CAUTION: " + (reasons.length ? reasons.join("; ") + "." : "a soft check did not pass.");
  }
  return (
    "SAFE: contract exists and is source-verified, not paused" +
    (f.priceWei != null
      ? f.expectedValue != null
        ? `, price ${f.priceWei} wei matches the expected value`
        : `, price ${f.priceWei} wei found`
      : ", no price getter — value proved by simulation") +
    ", and the call simulates cleanly."
  );
}

async function runChecks(input, { withSimulation }) {
  const contract = input.contract;
  const wallet = input.wallet || "0x0000000000000000000000000000000000000000";
  const value = String(input.value ?? "0");
  const expectedValue = input.expectedValue != null ? String(input.expectedValue) : null;
  const checks = [];
  const evidence = {
    sourcify: "unknown",
    priceWei: null,
    priceGetter: null,
    simulation: "not-run",
    revertReason: null,
    paused: null,
    supply: null,
  };
  let rpcUsed = null;
  const check = (name, status, detail) => {
    checks.push({ name, status, detail });
  };

  // 1. contractExists — eth_getCode, with a view-call probe because BSC RPCs
  // sometimes return empty code for live contracts (verify via a view call).
  let exists = null;
  try {
    const code = await rpcCall("eth_getCode", [contract, "latest"]);
    rpcUsed = code.rpc;
    if (code.result && code.result !== "0x" && code.result.length > 2) {
      exists = true;
      check("contractExists", "pass", `code present (${(code.result.length - 2) / 2} bytes)`);
    } else {
      let probed = null;
      for (const sig of ["totalSupply()", "paused()"]) {
        try {
          const r = await ethCallRaw({ to: contract, data: functionSelector(sig) });
          if (r.status === "ok" && r.data && r.data !== "0x" && hexToBytes(r.data).length >= 32) {
            probed = sig;
            break;
          }
        } catch {
          // probe failed — try the next one
        }
      }
      if (probed) {
        exists = true;
        check("contractExists", "pass", `getCode empty but ${probed} answered — contract exists (RPC quirk)`);
      } else {
        exists = false;
        check("contractExists", "fail", "eth_getCode returned empty and no view probe answered");
      }
    }
  } catch (e) {
    exists = null;
    check("contractExists", "unknown", "eth_getCode failed: " + (e.message || String(e)));
  }

  // 2. sourceVerified — Sourcify v2.
  const src = await checkSourcify(contract);
  evidence.sourcify = src;
  check(
    "sourceVerified",
    src === "exact" || src === "partial" ? "pass" : src === "unverified" ? "fail" : "unknown",
    src === "exact"
      ? "Sourcify exact match"
      : src === "partial"
        ? "Sourcify partial match"
        : src === "unverified"
          ? "not verified on Sourcify — source cannot be read independently"
          : "Sourcify lookup failed"
  );

  // 3. notPaused — paused() view call. No paused() => unknown, NOT fail.
  let paused = null;
  try {
    const r = await ethCallRaw({ from: wallet, to: contract, data: functionSelector("paused()") });
    if (r.status === "ok" && r.data && r.data !== "0x") paused = decodeBool(r.data);
  } catch {
    paused = null;
  }
  evidence.paused = paused;
  check(
    "notPaused",
    paused === false ? "pass" : paused === true ? "fail" : "unknown",
    paused === false ? "paused() = false" : paused === true ? "paused() = true — minting disabled" : "no paused() on this contract"
  );

  // 4. priceDiscovery — first no-arg price getter that answers wins.
  let priceWei = null;
  let priceGetter = null;
  for (const sig of PRICE_GETTERS) {
    try {
      const r = await ethCallRaw({ from: wallet, to: contract, data: functionSelector(sig) });
      if (r.status === "ok" && r.data && r.data !== "0x" && hexToBytes(r.data).length >= 32) {
        priceWei = decodeUint(r.data);
        priceGetter = sig;
        break;
      }
    } catch {
      // try the next getter
    }
  }
  evidence.priceWei = priceWei;
  evidence.priceGetter = priceGetter;
  check(
    "priceDiscovery",
    priceWei !== null ? "pass" : "unknown",
    priceWei !== null
      ? `${priceGetter} = ${priceWei} wei`
      : "no no-arg price getter answered (" + PRICE_GETTERS.join(" ") + ")"
  );

  // 5. freeSupply — best effort, informational only.
  const supply = {};
  for (const g of SUPPLY_GETTERS) {
    try {
      const data = encodeCall(g.sig, g.args(wallet));
      const r = await ethCallRaw({ from: wallet, to: contract, data });
      if (r.status === "ok" && r.data && r.data !== "0x" && hexToBytes(r.data).length >= 32) {
        supply[g.sig] = decodeUint(r.data);
      }
    } catch {
      // getter absent — try the next one
    }
  }
  evidence.supply = Object.keys(supply).length ? supply : null;
  check(
    "freeSupply",
    Object.keys(supply).length ? "pass" : "unknown",
    Object.keys(supply).length
      ? Object.entries(supply).map(([k, v]) => `${k} = ${v}`).join(", ")
      : "no supply getter answered"
  );

  // 6. simulation — only for /verify, not for /quote.
  let sim = "not-run";
  let simReason = null;
  if (withSimulation) {
    let data = null;
    try {
      if (input.calldata) data = input.calldata;
      else if (input.function) data = encodeCall(input.function, input.args || []);
    } catch (e) {
      check("simulation", "unknown", "could not encode call: " + (e.message || String(e)));
    }
    if (data) {
      try {
        const r = await ethCallRaw({
          from: wallet,
          to: contract,
          data,
          value: "0x" + BigInt(value).toString(16),
        });
        if (r.status === "ok") {
          sim = "success";
          check("simulation", "pass", `eth_call succeeded for ${input.calldata ? "calldata" : input.function} with value ${value} wei`);
        } else {
          sim = "revert";
          simReason =
            decodeRevertReason(r.data) ||
            (r.message ? r.message.replace(/^execution reverted:?\s*/i, "") : null) ||
            "reverted (no reason string)";
          check("simulation", "fail", "eth_call reverted" + (simReason ? `: ${simReason}` : ""));
        }
      } catch (e) {
        sim = "not-run";
        check("simulation", "unknown", "simulation RPC failed: " + (e.message || String(e)));
      }
    }
  }
  evidence.simulation = sim;
  evidence.revertReason = simReason;

  const verdict = decideVerdict({ exists, sourcify: src, paused, priceWei, expectedValue, sim });
  const summary = buildSummary(verdict, { exists, sourcify: src, paused, priceWei, expectedValue, sim, revertReason: simReason });
  return { verdict, checks, evidence, summary, rpc: rpcUsed };
}

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const DEMO_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MintGuard — BSC mint/claim verification agent</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#1a1a2e}
h1{font-size:1.4rem}label{display:block;margin:.6rem 0 .2rem;font-weight:600}
input{width:100%;padding:.5rem;border:1px solid #ccc;border-radius:6px;font:inherit}
button{margin-top:1rem;padding:.6rem 1.2rem;background:#0f766e;color:#fff;border:0;border-radius:6px;font:inherit;cursor:pointer}
pre{background:#0f172a;color:#e2e8f0;padding:1rem;border-radius:8px;overflow:auto;white-space:pre-wrap}
.verdict{font-size:1.2rem;font-weight:800;margin-top:1rem}
.safe{color:#15803d}.caution{color:#b45309}.blocked{color:#b91c1c}
small{color:#64748b}</style></head>
<body>
<h1>🛡️ MintGuard</h1>
<p>Read-only BSC mint/claim verification agent. Paste a contract, pick the call you are about to sign, and MintGuard checks it on-chain first — <b>SAFE / CAUTION / BLOCKED</b> with evidence. It never signs, never holds keys, never sends a transaction.</p>
<label>Contract address</label><input id="contract" value="0x86956Bc830EB62110820Ae79164BeF61c7E31936">
<label>Wallet (the signer)</label><input id="wallet" value="0xdB7CAcF14A5F67BA005FAc84d41fDDF28d1A34B6">
<label>Function (e.g. mint, mint(uint256), paused)</label><input id="fn" value="totalSupply">
<label>Args (JSON array, e.g. [])</label><input id="args" value="[]">
<label>Value (wei, decimal)</label><input id="value" value="0">
<label>Expected value (wei, optional — BLOCKED if the on-chain price differs)</label><input id="expected" value="">
<button onclick="verify()">Verify</button>
<div id="out"></div>
<p><small>Endpoints: <code>GET /health</code> · <code>POST /verify</code> · <code>POST /quote</code> — see the repo README for curl examples. BSC chain 56 only (v1).</small></p>
<script>
async function verify(){
  var out=document.getElementById('out'); out.innerHTML='Checking on-chain…';
  var body={contract:document.getElementById('contract').value.trim(),
    wallet:document.getElementById('wallet').value.trim(),
    value:document.getElementById('value').value.trim()||'0'};
  var fn=document.getElementById('fn').value.trim();
  if(fn) body.function=fn;
  try{ body.args=JSON.parse(document.getElementById('args').value||'[]'); }catch(e){ out.innerHTML='Args must be a JSON array.'; return; }
  var exp=document.getElementById('expected').value.trim();
  if(exp) body.expectedValue=exp;
  try{
    var r=await fetch('/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var j=await r.json();
    var cls=j.verdict==='SAFE'?'safe':j.verdict==='CAUTION'?'caution':'blocked';
    out.innerHTML='<div class="verdict '+cls+'">'+j.verdict+'</div><p>'+j.summary+'</p><pre>'+JSON.stringify(j,null,2)+'</pre>';
  }catch(e){ out.innerHTML='Request failed: '+e.message; }
}
</script>
</body></html>`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      if (url.pathname === "/" && request.method === "GET")
        return new Response(DEMO_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", ...CORS } });

      if (url.pathname === "/health" && request.method === "GET") {
        let rpcUsed = null;
        let chainOk = false;
        try {
          const r = await rpcCall("eth_chainId", []);
          rpcUsed = r.rpc;
          chainOk = r.result === "0x38"; // 56 = BSC
        } catch {
          chainOk = false;
        }
        return json({ ok: chainOk, chain: CHAIN_ID, rpc: rpcUsed });
      }

      if (url.pathname === "/verify" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body || !body.contract || !isAddress(body.contract))
          return json({ error: "body.contract must be a 0x address" }, 400);
        if (body.wallet && !isAddress(body.wallet))
          return json({ error: "body.wallet must be a 0x address" }, 400);
        if (body.value != null && !/^\d+$/.test(String(body.value)))
          return json({ error: "body.value must be a decimal wei string" }, 400);
        if (body.expectedValue != null && !/^\d+$/.test(String(body.expectedValue)))
          return json({ error: "body.expectedValue must be a decimal wei string" }, 400);
        const out = await runChecks(body, { withSimulation: true });
        return json(out);
      }

      if (url.pathname === "/quote" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body || !body.contract || !isAddress(body.contract))
          return json({ error: "body.contract must be a 0x address" }, 400);
        if (body.wallet && !isAddress(body.wallet))
          return json({ error: "body.wallet must be a 0x address" }, 400);
        const out = await runChecks(body, { withSimulation: false });
        const free = out.evidence.priceWei != null ? out.evidence.priceWei === "0" : null;
        return json({
          contract: body.contract,
          checks: out.checks,
          priceWei: out.evidence.priceWei,
          priceGetter: out.evidence.priceGetter,
          paused: out.evidence.paused,
          supply: out.evidence.supply,
          sourcify: out.evidence.sourcify,
          free,
          summary: out.summary,
        });
      }

      return json({ error: "not found", routes: ["GET /", "GET /health", "POST /verify", "POST /quote"] }, 404);
    } catch (e) {
      return json({ error: "internal error: " + (e && e.message ? e.message : String(e)) }, 500);
    }
  },
};
