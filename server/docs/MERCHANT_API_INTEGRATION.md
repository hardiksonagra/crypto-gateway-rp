# Merchant API integration guide

This document is for **merchants** who use the **merchant portal** (`/m`) and need their **own backend or app** to accept crypto deposits via the gateway.

There are **two separate auth mechanisms**:

| Use case | How you authenticate | Base paths |
|----------|----------------------|------------|
| **Browser portal** (dashboard, settings, reports) | **JWT** after email/password login | `/api/v1/auth/*`, `/api/v1/merchant/*` |
| **Your server calling the gateway** (deposit addresses, extra wallets) | **Merchant API key** (`api_key` in JSON body) | `/api/v1/gateway/*` |

The API key is **not** the same as the login JWT. End users of your product should **never** see the API key.

---

## 1. Merchant portal login (JWT)

Used by the React app and optional tooling (Postman, scripts) to access **your** data in the dashboard.

### 1.1 Login

```http
POST /api/v1/auth/login
Content-Type: application/json
```

```json
{
  "email": "merchant@example.com",
  "password": "your-password"
}
```

**200**

```json
{
  "token": "<JWT>",
  "role": "MERCHANT",
  "email": "merchant@example.com",
  "display_name": "Demo Merchant"
}
```

**401** — `{ "error": "invalid_credentials" }` (wrong password, unknown email, or deactivated account).

### 1.2 Authenticated requests

Send the token on every request:

```http
Authorization: Bearer <JWT>
```

### 1.3 Current user (settings snapshot)

```http
GET /api/v1/auth/me
Authorization: Bearer <JWT>
```

Returns your profile fields used by the UI, including `defaultChains`, `defaultCurrency`, `defaultNetwork`, `supportedDepositRails`, `callbackUrl`, `apiKeyHint` (last characters of the key only — **not** the secret).

### 1.4 Other merchant-scoped routes

All require `Authorization: Bearer` and `MERCHANT` role, for example:

- `GET /api/v1/merchant/dashboard`
- `GET /api/v1/merchant/users`
- `GET /api/v1/merchant/transactions`
- `PATCH /api/v1/merchant/settings` — update callback URL, supported chains, and **supported deposit rails** (same as the Settings page)

Full list: see `server/src/api/merchant-routes.js`.

---

## 2. Integration settings (before coding against the gateway)

Configure these in the portal (**Settings** / `/m/settings`) or via `PATCH /api/v1/merchant/settings` with your JWT:

| Setting | Effect on integration |
|---------|------------------------|
| **Callback URL** | HTTPS URL that receives `payment.success` webhooks (see §6). |
| **Supported chains** | Underlying chains the gateway may use. Each deposit **rail** must belong to one of these chains. |
| **Supported currency / network (rails)** | Whitelist of `(currency, network)` pairs your API key may use (e.g. `USDT` + `TRC20`). If this list is **non-empty**, requests for other pairs return `rail_not_enabled_for_merchant`. If the list is **empty** (legacy), any gateway rail on a supported chain is allowed. |
| **Default pair** (stored as `default_currency` / `default_network`) | Set automatically from the **first** rail in your supported list when you save settings. Used when `deposit-address` is called **without** `currency` and `network`. |

**Important:** Put the rail you want as the default **first** in the supported list (selection order in the UI defines the array order).

---

## 3. Merchant API key (gateway)

- Issued when an **admin** creates the merchant or when you **regenerate** the key (old key stops working).
- Shown **once** in the admin UI or modal — store it in **secrets** (environment variables, vault), not in git or frontend bundles.
- Passed as JSON field **`api_key`** on `/api/v1/gateway/*` routes (no `Authorization` header required for those routes).

---

## 4. Supported deposit rails (gateway)

These `(currency, network)` pairs are accepted when they resolve to a known rail **and** your merchant is allowed to use them (see §2).

| `currency` | `network` | Chain |
|------------|-----------|--------|
| `USDT` | `TRC20` | TRON |
| `USDT` | `ERC20` | ETH |
| `USDT` | `TON` | TON |
| `USDT` | `BEP20` | BNB |
| `TRX` | `TRON` | TRON |

Values are matched case-insensitively after trim.

---

## 5. Gateway API reference

All gateway routes: `Content-Type: application/json`.

### 5.1 Get or create deposit address

```http
POST /api/v1/gateway/deposit-address
```

| Field | Required | Description |
|-------|----------|-------------|
| `api_key` | Yes | Merchant API secret. |
| `external_user_id` | Yes | Stable unique id of the payer on **your** system. |
| `currency` | No | e.g. `USDT`. If omitted, merchant **default** pair is used. |
| `network` | No | e.g. `TRC20`. If omitted, merchant **default** pair is used. |

**200**

```json
{
  "address": "T… or 0x…",
  "chain": "TRON",
  "currency": "USDT",
  "network": "TRC20",
  "wallet_id": "cl…",
  "user_id": "cl…",
  "merchant_id": "cl…",
  "created_new_user": false
}
```

| HTTP | `error` | Meaning |
|------|---------|---------|
| 400 | (message) | Missing `api_key` / `external_user_id`, or unsupported pair. |
| 401 | `invalid_api_key` | Bad or inactive key. |
| 403 | `rail_not_enabled_for_merchant` | Pair not in your supported rails (when configured). |
| 400 | `unsupported_currency_network` | Unknown `currency`/`network` combination. |

Idempotent: same merchant + `external_user_id` + same `(currency, network)` returns the same wallet.

### 5.2 Create another wallet (same user, another rail)

```http
POST /api/v1/gateway/create-wallet
```

| Field | Required | Description |
|-------|----------|-------------|
| `api_key` | Yes | Merchant API secret. |
| `user_id` | Yes | Gateway `user_id` from `deposit-address`. |
| `currency` | Yes | e.g. `USDT` |
| `network` | Yes | e.g. `ERC20` |

**200** — same shape as deposit-address wallet fields (`address`, `chain`, `currency`, `network`, `wallet_id`).

**404** — user not found for this merchant.

**403** — `rail_not_enabled_for_merchant` when applicable.

### 5.3 Transaction history by deposit address

```http
GET /api/v1/gateway/transactions?address={deposit_address}
```

Optional query: `currency`, `network` (both required together to filter).

Returns up to **200** recent transactions; amounts are in **smallest units** — use `token_decimals` for display.

---

## 6. Webhooks (`payment.success`)

When a transaction reaches **success**, the gateway POSTs to your **callback URL** (from merchant settings).

```http
POST {callback_url}
Content-Type: application/json
X-Webhook-Event: payment.success
```

Example body fields include `tx_hash`, `amount`, `status`, `chain`, `token_symbol`, `wallet_address`, `confirmations`, `external_user_id`, `merchant_id`. Treat delivery as **at-least-once**; dedupe with `tx_hash` + `chain` + `wallet` + `token_symbol`.

The gateway does not sign webhooks by default — protect your endpoint (secret token in URL, mTLS, or IP allowlist).

---

## 7. Minimal integration checklist

1. Log in to `/m`, set **callback URL**, **chains**, and **supported rails** (order = default rail first).
2. Store **`api_key`** from admin onboarding in server-side config.
3. On checkout, call **`deposit-address`** with `external_user_id` and optionally `currency` / `network`.
4. Show the user the returned **`address`** and the correct **`network`** label (e.g. TRC20 vs ERC20).
5. Handle **`payment.success`** on your callback URL.

---

## 8. Related docs

- [CLIENT_INTEGRATION.md](./CLIENT_INTEGRATION.md) — third-party overview (being aligned with this guide).
- Operator: runbook in repo root / `server` workspace for migrate, seed, env vars.

---

## 9. Development quick reference

After seed (see `.env` / operator docs):

| Item | Example |
|------|---------|
| Merchant login | `merchant@gateway.local` / `Merchant#Demo1` |
| Demo API key | `cpg_live_demo_dev_only_change_me` |

Change passwords and rotate API keys before production.
