# Crypto Payment Gateway — Client integration guide

This document is for **developers integrating your application** with the payment gateway API. Share your **base URL** (e.g. `https://payments.yourcompany.com`) with clients; all paths below are relative to that base.

---

## 1. Overview

| Item | Description |
|------|-------------|
| **Purpose** | Issue **per-user deposit addresses** per blockchain, **detect incoming payments**, and **notify your server** via webhook when a payment reaches the required confirmations. |
| **Format** | JSON over HTTPS |
| **Authentication** | **Not implemented in the default gateway.** Expose the API behind your own **API gateway / reverse proxy** with API keys or mTLS before giving clients production access. |
| **Content-Type** | `application/json` for `POST` bodies |

---

## 2. Payment flow (recommended)

1. **Register the payer & get address** — Call **`POST /api/deposit-address`** once per payer per chain (see §4.2). For additional chains for the same user, either call **`POST /api/deposit-address`** again with the same identity fields or use **`POST /api/create-wallet`** with the returned `user_id`.
2. **Choose network** — Ask the end-user which asset/network they will use (e.g. USDT on TRON vs USDT on Ethereum). Wrong network can cause **lost funds**.
3. **Get a deposit address** — Same user + same `chain` always returns the **same** address (idempotent).
4. **Show the address (and network)** to the user so they send crypto only on that chain.
5. **Confirm on your side** — Poll `GET /api/transactions?address=...` or rely on the **webhook** on the `callback_url` you registered for that payer when status is final.

---

## 3. Supported chains (`chain` value)

Use these **exact** strings in `POST /api/deposit-address` and `POST /api/create-wallet`:

| `chain` | Network |
|---------|---------|
| `ETH` | Ethereum (native ETH + configured ERC-20s on gateway) |
| `BNB` | BNB Smart Chain (native BNB + configured BEP-20s) |
| `POLYGON` | Polygon PoS (native MATIC + configured ERC-20–style tokens) |
| `ARBITRUM` | Arbitrum One (native ETH + configured ERC-20s) |
| `OPTIMISM` | Optimism (native ETH + configured ERC-20s) |
| `TRON` | TRON (native TRX + configured TRC-20s) |
| `BTC` | Bitcoin (native BTC) |
| `TON` | TON (native TON + configured jettons; **USDT** jetton tracked by default) |

**EVM note:** For `ETH`, `BNB`, `POLYGON`, `ARBITRUM`, `OPTIMISM`, the **same 0x address** may be reused across chains (same HD key), but the user **must send on the chain you told them**. Deposits on the wrong chain are not credited by this indexer.

---

## 4. API reference

### 4.1 Health

```http
GET /health
```

**Response `200`**

```json
{ "ok": true }
```

---

### 4.2 Get or create deposit address (single entry — required)

Creates the gateway **user** if needed, then returns the **deposit address** for `chain`. Use **either** the integrator identity **or** a plain **email** (not both).

```http
POST /api/deposit-address
Content-Type: application/json
```

**Body — mode A (SaaS / integrators, recommended)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `merchant_ref` | string | Yes* | Stable id for **your** product / tenant (e.g. `acme-shop`). |
| `external_user_id` | string | Yes* | The **unique id of the payer on your website** (your DB user id, etc.). |
| `callback_url` | string | No | HTTPS URL for **`payment.success`** webhooks. Can be set or updated on a later call with the same `merchant_ref` + `external_user_id`. |
| `chain` | string | Yes | One of the values in §3 (e.g. `ETH`, `BNB`). |

\*Required together when using mode A. If both are present, mode A is used (even if `email` is also sent).

**Body — mode B (email-based)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | Unique customer email in the gateway DB. |
| `callback_url` | string | No | Webhook URL (same semantics as mode A). |
| `chain` | string | Yes | One of the values in §3. |

**Behaviour**

- **Mode A:** First time `(merchant_ref, external_user_id)` is seen → creates internal **user** + **wallet** for `chain` → `created_new_user: true`. Same pair + same `chain` → same `address`, `created_new_user: false`.
- **Mode B:** First time `email` is seen → creates **user** + **wallet**; repeat calls → same user, same address for that `chain`.
- Webhooks use the stored **`callback_url`** on that user.

**Response `200`**

```json
{
  "address": "0x…",
  "chain": "ETH",
  "wallet_id": "clxxxxxxxxxxxxxxxx",
  "user_id": "clyyyyyyyyyyyyyyyy",
  "created_new_user": false
}
```

**Errors**

| Status | Body |
|--------|------|
| `400` | Missing `chain`, missing identity (`merchant_ref`+`external_user_id` or `email`), invalid refs, or unsupported `chain`. |
| `503` | `{ "error": "database unavailable" }` |
| `500` | `{ "error": "internal error" }` |

**Security note:** In production, protect this route (API key, mTLS) so arbitrary callers cannot bind `callback_url` to someone else’s identity.

---

### 4.3 Create wallet (optional — same `user_id`, another `chain`)

```http
POST /api/create-wallet
Content-Type: application/json
```

**Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_id` | string | Yes | From `POST /api/deposit-address` response (`user_id`). |
| `chain` | string | Yes | One of the values in §3. |

**Response `200`**

```json
{
  "address": "0x… or T… or bc1…",
  "chain": "ETH",
  "wallet_id": "clxxxxxxxxxxxxxxxx"
}
```

Calling again with the same `user_id` + `chain` returns the **same** wallet (idempotent).

**Errors**

| Status | Body |
|--------|------|
| `400` | `{ "error": "user_id and chain required" }` or unsupported `chain`. |
| `404` | `{ "error": "user not found" }` |
| `500` | `{ "error": "internal error" }` |

---

### 4.4 Transaction history

```http
GET /api/transactions?address={deposit_address}
```

| Query | Required | Description |
|-------|----------|-------------|
| `address` | Yes | The deposit address returned by `create-wallet`. EVM addresses are matched **case-insensitively**. |

**Response `200`**

```json
{
  "transactions": [
    {
      "id": "clxxxxxxxxxxxxxxxx",
      "tx_hash": "0x…",
      "from_address": "0x…",
      "to_address": "0x…",
      "amount": "1000000000000000000",
      "token_symbol": "ETH",
      "token_decimals": 18,
      "chain": "ETH",
      "status": "success",
      "confirmations": 12,
      "block_number": "12345678",
      "created_at": "2026-03-22T10:00:00.000Z",
      "updated_at": "2026-03-22T10:05:00.000Z"
    },
    {
      "id": "clyyyyyyyyyyyyyyyy",
      "tx_hash": "0x…",
      "from_address": "0x…",
      "to_address": "0x…",
      "amount": "500000000",
      "token_symbol": "USDT",
      "token_decimals": 6,
      "chain": "ETH",
      "status": "success",
      "confirmations": 12,
      "block_number": "12345680",
      "created_at": "2026-03-22T10:10:00.000Z",
      "updated_at": "2026-03-22T10:15:00.000Z"
    }
  ]
}
```

**Important — `amount`**

- `amount` is always in the **smallest on-chain unit** (integer as string): **wei** (EVM native & ERC-20/BEP-20 use decimals from the token), **sun** (TRON native & TRC-20), **satoshi** (BTC).
- Convert for display:  
  `human = BigInt(amount) / 10^token_decimals`
- For **tokens**, `token_symbol` and `token_decimals` describe the asset (e.g. USDT with 6 decimals on Ethereum).

**`status`**

| Value | Meaning |
|-------|---------|
| `pending` | Seen on-chain but confirmations below gateway threshold. |
| `success` | Confirmations ≥ threshold; webhook may have been sent. |
| `failed` | Reserved; rarely used in current indexer. |

At most **200** recent transactions are returned.

**Errors**

| Status | Body |
|--------|------|
| `400` | `{ "error": "address query param required" }` |

---

## 5. Webhooks (payment confirmed)

When a transaction reaches **`success`**, the gateway **POSTs** JSON to the user’s `callback_url` (from `POST /api/deposit-address`), **once per transaction** (retries may occur if delivery fails until a `2xx` response is returned).

**Request**

```http
POST {callback_url}
Content-Type: application/json
X-Webhook-Event: payment.success
```

**Body (native coin example)**

If the payer was created via **`POST /api/deposit-address`**, these fields are included when set:

- `merchant_ref` — your `merchant_ref`
- `external_user_id` — your customer id on your site

```json
{
  "tx_hash": "0x…",
  "amount": "1000000000000000000",
  "status": "success",
  "chain": "ETH",
  "token_symbol": "ETH",
  "wallet_address": "0x…",
  "confirmations": 12,
  "merchant_ref": "acme-shop",
  "external_user_id": "user-12345"
}
```

**Body (ERC-20 / BEP-20 / TRC-20 example)**

```json
{
  "tx_hash": "0x…",
  "amount": "1000000000",
  "status": "success",
  "chain": "BNB",
  "token_symbol": "USDT",
  "wallet_address": "0x…",
  "confirmations": 12
}
```

Use the same **`amount` + `token_decimals`** rules as in §4.4 (webhook payload does not repeat `token_decimals`; store decimals from your supported-asset table or from prior `GET /api/transactions` responses).

**Your endpoint should**

1. Respond with **HTTP 2xx** within a reasonable time (gateway timeout ~10s).
2. Treat delivery as **at-least-once**: use `tx_hash` + `chain` + `wallet_address` + **`token_symbol`** for **idempotent** processing in your DB (one tx can include both native and token transfers; your idempotency key should distinguish them).
3. **Verify** requests in production (e.g. shared secret header or signature) — the default gateway does not sign webhooks; add verification at your API gateway or extend the gateway.

If `callback_url` was omitted or empty, **no webhook** is sent.

---

## 6. ERC-20, BEP-20, and TRC-20 token deposits

The gateway can index **standard token transfers** to the same deposit addresses as native coins. Token detection is **allowlist-based**: only contracts registered by the **operator** are processed.

### 6.1 What integrators (your clients) must know

| Topic | Detail |
|-------|--------|
| **Deposit address** | Same as for native: from `POST /api/create-wallet` for the correct `chain`. |
| **User instruction** | Always state **exact network** (e.g. “USDT on **BNB Smart Chain**”, not just “USDT”). Wrong chain = lost funds. |
| **API fields** | Token payments appear in `GET /api/transactions` with `token_symbol`, `token_decimals`, and `amount` in the token’s smallest unit. |
| **Configuration** | Clients **cannot** add new token contracts via API; the **gateway operator** updates env config (see §6.5). You publish a **supported assets** list to clients. |

### 6.2 ERC-20 (Ethereum, Polygon, Arbitrum, Optimism)

- **Standard:** ERC-20 `Transfer(address indexed from, address indexed to, uint256 value)` events.
- **Chains in this gateway:** `ETH`, `POLYGON`, `ARBITRUM`, `OPTIMISM` (each has its own token contract addresses on that network).
- **Same 0x address** may be used across these EVM chains, but **USDT on Ethereum ≠ USDT on Polygon** (different contracts and networks). Match `chain` in API responses to the network you showed the user.

### 6.3 BEP-20 (BNB Smart Chain)

- **Standard:** BEP-20 is **functionally the same** as ERC-20 on EVM; the gateway uses the same log decoding.
- **Chain value:** `BNB` in `POST /api/create-wallet`.
- **Configuration:** Token contracts are registered under the **`BNB`** key in the operator’s EVM token map (same env structure as ERC-20, see §6.5).

### 6.4 TRC-20 (TRON)

- **Standard:** TRC-20 transfers on TRON (indexed via TronGrid-style APIs for tracked contracts).
- **Chain value:** `TRON` in `POST /api/create-wallet`.
- **Address format:** Base58 TRON addresses (not `0x`).
- **Configuration:** Separate env map **`TRC20_CONTRACTS`** keyed by **token contract address** (see §6.5).

### 6.5 Operator configuration (environment variables)

These are set on the **gateway server** (not by client API calls).

| Variable | Purpose |
|----------|---------|
| **`ERC20_CONTRACTS`** | JSON object: **gateway `chain` name** → **checksum or lowercase 0x contract address** → `{ "symbol": "USDT", "decimals": 6 }`. Used for **ERC-20** on ETH / Polygon / Arbitrum / Optimism and **BEP-20** on BNB. |

**Keys must match** the internal chain enum: `ETH`, `BNB`, `POLYGON`, `ARBITRUM`, `OPTIMISM`.

**Example (pretty-printed; in `.env` use one line or escape newlines):**

```json
{
  "ETH": {
    "0xdac17f958d2ee523a2206206994597c13d831ec7": { "symbol": "USDT", "decimals": 6 },
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { "symbol": "USDC", "decimals": 6 }
  },
  "BNB": {
    "0x55d398326f99059ff775485246999027b3197955": { "symbol": "USDT", "decimals": 18 }
  },
  "POLYGON": {
    "0xc2132d05d31c914a87c6611c10748aeb04b58e8f": { "symbol": "USDT", "decimals": 6 }
  },
  "ARBITRUM": {
    "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": { "symbol": "USDT", "decimals": 6 }
  },
  "OPTIMISM": {
    "0x0b2c639c533813f4aa9d7837caf62653d097ff85": { "symbol": "USDC", "decimals": 6 }
  }
}
```

Contract addresses above are **examples only** — verify current official addresses before mainnet use.

| Variable | Purpose |
|----------|---------|
| **`TRC20_CONTRACTS`** | JSON object: **TRON token contract address** (base58 or as returned by your explorer) → `{ "symbol": "USDT", "decimals": 6 }`. |

**Example:**

```json
{
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t": { "symbol": "USDT", "decimals": 6 }
}
```

If a map is empty (`{}`), the gateway still tracks **native** assets only for that mechanism (EVM tokens or TRC-20 respectively).

### 6.6 Deduping and multiple transfers

- Each indexed transfer is stored with a unique key including **`tx_hash`**, **`chain`**, **`wallet`**, **`token_symbol`**, and **EVM log index** (native transfers use a sentinel index).  
- Integrators should treat **`tx_hash` + chain + token_symbol + wallet_address`** (or your internal payment id) as the logical idempotency key for webhooks.

---

## 7. Integration checklist for clients

- [ ] Store `user_id` and map it to your internal customer ID.
- [ ] Always ask **which chain/token** before showing a deposit address.
- [ ] Display **network name** and **address** clearly (QR optional).
- [ ] Publish which **ERC-20 / BEP-20 / TRC-20** assets you support (aligned with operator allowlist).
- [ ] Implement webhook handler with **idempotency** on `tx_hash` + `chain` + **`token_symbol`** (+ `wallet_address`).
- [ ] Optionally poll `GET /api/transactions` as a backup if webhooks fail.
- [ ] Parse `amount` using `token_decimals` (smallest units) for both native and tokens.

---

## 8. Operator / support contacts

Document here for your clients:

- **Production base URL:** `________________________`
- **Support email / status page:** `________________________`
- **Supported assets & networks:** `________________________`

---

## 9. Versioning

This gateway does not yet expose an API version prefix (e.g. `/v1`). Breaking changes should be communicated to integrators in advance, or you should add `/v1` routing at your reverse proxy.
