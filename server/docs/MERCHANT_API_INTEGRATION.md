# Merchant API integration guide

This document is for **merchants** who use the **merchant portal** (`/m`) and need their **own backend or app** to accept crypto deposits via the gateway.

There are **two separate auth mechanisms**:

| Use case | How you authenticate | Base paths |
|----------|----------------------|------------|
| **Browser portal** (dashboard, settings, reports) | **JWT** after email/password login | `/api/v1/auth/*`, `/api/v1/merchant/*` |
| **Your server calling the gateway** (deposit addresses, extra wallets) | **`X-Token` + `X-Merchant-Id` headers** (recommended), or legacy **`api_key`** in JSON body | `/api/v1/gateway/*` |

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
- Gateway POST routes accept either **recommended header auth** (`X-Token`) or **legacy** JSON field **`api_key`**. No `Authorization` JWT is required for `/api/v1/gateway/*` (that JWT is for the browser portal only).

### 3.1 Recommended: `X-Token` (secret not in the JSON body)

For **POST** routes, send the **same JSON body as before but omit `api_key`**, and add headers below. **Live vs sandbox** defaults to the merchant **portal profile** (Settings); omit `gateway_environment` in JSON unless you need an override when live and sandbox share one secret.

| Header | Value |
|--------|--------|
| `X-Merchant-Id` | Your numeric merchant id (positive integer). Same as `id` from `GET /api/v1/auth/me` when logged into the merchant portal. |
| `X-Token` | Base64 string: **AES-256-GCM** encryption of the **canonical JSON** of the request body (UTF-8 plaintext). |

**Canonical JSON:** at every object level, sort keys **lexicographically**; serialize with no extra whitespace (standard `JSON`-style primitives). Arrays keep element order. The string you encrypt must be **exactly** this canonical form of the body the server will parse (after `Content-Type: application/json` decoding).

**Key material:** derive a 32-byte AES key as **SHA-256** (binary digest) of the merchant API secret string (UTF-8). Use **AES-256-GCM** with a random 12-byte IV per request; append the 16-byte GCM auth tag; wire format is **base64**( `IV || tag || ciphertext` ) (12 + 16 + ciphertext length).

The server decrypts `X-Token` with your stored gateway secret and checks that the plaintext **equals** the canonical JSON of the received body. If not, the call fails with `invalid_x_token` (tampering or wrong secret). Do **not** send `api_key` in the body when using `X-Token` on **POST** routes (you would get `ambiguous_gateway_auth`).

**GET** `/api/v1/gateway/supported-currency` has no body: build `X-Token` from canonical JSON `{"api_key":"<your_secret>"}` only (secret encrypted inside the token, not sent as plain text).

### 3.2 Legacy: `api_key` in the JSON body

You may still pass **`api_key`** in the body on the same routes. New integrations should prefer **`X-Token`** so the secret is not embedded in JSON logs or proxies.

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

Most gateway **POST** routes use `Content-Type: application/json`. **Supported currency list** is **GET** with headers only (see below).

### List supported currency pairs

**GET (no JSON body)**

```http
GET /api/v1/gateway/supported-currency
X-Merchant-Id: {your numeric merchant id from GET /api/v1/auth/me}
X-Token: {base64 AES-256-GCM ciphertext}
```

Build `X-Token` exactly like other gateway tokens, but the encrypted **plaintext** must be the **canonical JSON** string of a single object: `{"api_key":"<your full gateway secret>"}` (sorted keys; only field `api_key`). The secret is **not** sent in the clear on the wire.

**Live vs sandbox:** you do **not** need to pass `gateway_environment`. The gateway uses the merchant’s **portal profile** (Live / Sandbox in **Settings** — same as the dashboard). Optional query `?gateway_environment=live` or `sandbox` is only for **overriding** that default when live and sandbox share **one** API key and you need the other environment without changing Settings.

**200** — `{ "pairs": [...], "default_currency", "default_network", "gateway_environment" }`.

### 5.1 Get or create deposit address

```http
POST /api/v1/gateway/deposit-address
```

| Field | Required | Description |
|-------|----------|-------------|
| `api_key` | Legacy only | Merchant API secret; omit when using `X-Token` + `X-Merchant-Id`. |
| `external_user_id` | Yes | Stable unique id of the payer on **your** system. |
| `currency` | No | e.g. `USDT`. If omitted, merchant **default** pair is used. |
| `network` | No | e.g. `TRC20`. If omitted, merchant **default** pair is used. |
| `gateway_environment` | No | **Omit** to use the merchant portal **Live/Sandbox** setting (Settings). Optional override only when live and sandbox share one secret and you need the other environment. |
| Headers | With `X-Token` | `X-Token` (required), `X-Merchant-Id` (required). |

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
| 400 | `gateway_auth_required` | Neither `api_key` nor `X-Token` auth provided. |
| 400 | `x_merchant_id_required` | `X-Token` sent without `X-Merchant-Id`. |
| 400 | `ambiguous_gateway_auth` | Both `api_key` and `X-Token` sent. |
| 400 | (message) | Missing `external_user_id`, or unsupported pair. |
| 401 | `invalid_api_key` | Bad or inactive key (legacy body auth). |
| 401 | `invalid_x_token` | Token does not match body / secret. |
| 401 | `invalid_x_merchant_id` | Unknown or inactive merchant id. |
| 503 | `gateway_secret_unavailable` | Server cannot verify `X-Token` (missing cipher; regenerate key). |
| 403 | `rail_not_enabled_for_merchant` | Pair not in your supported rails (when configured). |
| 400 | `unsupported_currency_network` | Unknown `currency`/`network` combination. |

Idempotent: same merchant + `external_user_id` + same `(currency, network)` returns the same wallet.

### 5.2 Create another wallet (same user, another rail)

```http
POST /api/v1/gateway/create-wallet
```

| Field | Required | Description |
|-------|----------|-------------|
| `api_key` | Legacy only | Omit when using `X-Token` + `X-Merchant-Id`. |
| `user_id` | Yes | Gateway `user_id` from `deposit-address`. |
| `currency` | Yes | e.g. `USDT` |
| `network` | Yes | e.g. `ERC20` |
| Headers | With `X-Token` | `X-Token`, `X-Merchant-Id`. |

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
2. Store **`api_key`** from admin onboarding in server-side secrets; note your **`id`** from `GET /api/v1/auth/me` for `X-Merchant-Id` when using header auth.
3. On checkout, call **`deposit-address`** with `external_user_id` and optionally `currency` / `network`, using **`X-Token`** (recommended) or legacy **`api_key`** in the body.
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
