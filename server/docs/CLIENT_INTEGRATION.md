# Crypto Payment Gateway — Third-party integration (v1)

Share your **HTTPS base URL** (e.g. `https://payments.example.com`) with integrators. All paths below are **relative** to that base.

**Merchants** using the portal and integrating their backend should read **[MERCHANT_API_INTEGRATION.md](./MERCHANT_API_INTEGRATION.md)**. That guide is organized in **three parts**: **Part I** (supported currency & gateway setup), **Part II** (pay-in / deposits), **Part III** (payout). **Part I §I.3.1** covers **PHP `json_encode` + `JSON_UNESCAPED_SLASHES`**, **`Content-Type: application/json`**, and matching the wire body to the canonical string for `X-Token`.

---

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**        | Issue **per-customer deposit addresses**, detect incoming transfers, and **POST webhooks** to the merchant’s configured callback URL when a payment is confirmed.                                                                                                 |
| **Format**         | JSON over HTTPS (`Content-Type: application/json`)                                                                                                                                                                                                                |
| **Authentication** | Preferred: **`X-Token`** + **`X-Merchant-Id`**. Legacy: **`api_key`** in JSON. Keys are created in the **admin portal** when a merchant is provisioned (shown **once**). See [MERCHANT_API_INTEGRATION.md — Part I §I.3](./MERCHANT_API_INTEGRATION.md#i3-merchant-api-key-gateway).                     |
| **Rails**          | Deposits are identified by `**currency`** + `**network`** (e.g. `USDT`+`TRC20`). Merchants configure **supported chains** and **supported rails** in the portal; if omitted on `deposit-address`, the merchant’s **default** pair is used (first supported rail). |

---

## 2. Flow

1. Merchant configures **callback URL**, **supported chains**, and **supported currency/network rails** in the portal (`/m/settings`).
2. Integrator calls `**POST /api/v1/gateway/deposit-address`** with gateway auth (`X-Token` + `X-Merchant-Id`, or legacy `api_key`) and `external_user_id`, and optionally `currency` + `network`, optional **`amount`** (fixed checkout total), optional **`transaction_id`** (your order id), optional **`redirect_url`** (optional HTTPS return URL stored and echoed on **200**).
3. Response includes `address`, `chain`, `currency`, `network`, **`transaction_id`** and **`reference_id`** (same checkout reference — your optional request `transaction_id` or gateway-generated). When `amount` was sent, the response also includes **`expected_amount_decimal`** / **`expected_amount_atomic`** for display. A successful call normally creates a **`transactions` row** with `status: "created"` (placeholder, `amount` 0) — with or without optional `amount` — using that same reference; poll with **`GET /api/v1/gateway/transactions?transaction_id=…`** (gateway auth headers; single row JSON). **Reuse:** if the same end-user + rail already has an open **`created`** placeholder and this call matches it (same optional merchant **`transaction_id`** when sent, and the same expected amount), the gateway **returns that checkout** and refreshes timers instead of inserting another row. Same customer + rail is idempotent for the **wallet**. For **another rail** for the same end user, call **`deposit-address` again** with the same **`external_user_id`** and the desired **`currency`** / **`network`** (unless a per-user **cooldown** returns **`429 deposit_address_cooldown`** — see [Part II §II.1](./MERCHANT_API_INTEGRATION.md#ii1-get-or-create-deposit-address)).
4. User sends crypto to the shown address on the **correct network** (show **amount due** from the response when you passed `amount`).
5. When confirmations pass, the gateway POSTs to the merchant **callback URL** with **`X-Webhook-Event: payment`** and JSON **`status`** (`success`, `underpaid`, etc.). Credits on a wallet with multiple open checkouts apply **LIFO** to the newest unpaid **`created`** placeholder. If you used a fixed **`amount`** and the first on-chain credit is **below** the expected session total, **`status` is `underpaid`** first; when the **combined** session total reaches the expected amount, another POST with **`status: success`** follows (see [MERCHANT_API_INTEGRATION.md — Part II §II.3](./MERCHANT_API_INTEGRATION.md#ii3-payment-webhooks-x-webhook-event-payment)). **Payouts** do not use webhooks — **`POST /api/v1/gateway/payout`** auto-sends within limits (201 often already `completed` / `failed`); otherwise poll **`GET /api/v1/gateway/payout?client_reference_id=…`** ([Part III](./MERCHANT_API_INTEGRATION.md#part-iii-payout)).

---

## 3. Supported `chain` values (response / internal)

| `chain`    | Network         |
| ---------- | --------------- |
| `ETH`      | Ethereum        |
| `BNB`      | BNB Smart Chain |
| `POLYGON`  | Polygon PoS     |
| `ARBITRUM` | Arbitrum One    |
| `OPTIMISM` | Optimism        |
| `TRON`     | TRON            |
| `BTC`      | Bitcoin         |
| `TON`      | TON             |

**EVM note:** The same **0x address** may repeat across EVM chains; the integrator **must** match the `chain` / `network` returned to what the end user is shown.

---

## 4. Supported gateway rails (`currency` + `network`)

| `currency` | `network` | `chain` |
| ---------- | --------- | ------- |
| `USDT`     | `TRC20`   | TRON    |
| `USDT`     | `ERC20`   | ETH     |
| `USDT`     | `TON`     | TON     |
| `USDT`     | `BEP20`   | BNB     |
| `TRX`      | `TRON`    | TRON    |

Merchants may restrict which of these are allowed via portal settings.

---

## 5. API reference

### 5.1 Health

```http
GET /health
```

**200** — `{ "ok": true }`

---

### 5.2 Get or create deposit address

```http
POST /api/v1/gateway/deposit-address
Content-Type: application/json
```

| Field              | Type   | Required  | Description                                                                                                                                                              |
| ------------------ | ------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api_key`          | string | Legacy    | Merchant API secret; omit when using `X-Token` + `X-Merchant-Id`.                                                                                                        |
| `external_user_id` | string | Yes       | Stable unique id of the payer on **your** system.                                                                                                                        |
| `currency`         | string | No        | Upper-case token symbol (e.g. `USDT`). Defaults to merchant default.                                                                                                     |
| `network`          | string | No        | Network label (e.g. `TRC20`). Defaults to merchant default.                                                                                                              |
| `amount`           | string | No        | Optional fixed total: decimal (e.g. `10.5`) or digits-only **whole USDT** (e.g. `11` = 11 USDT). USDT on TRC20/ERC20/BEP20; see [MERCHANT_API_INTEGRATION.md — Part II §II.1](./MERCHANT_API_INTEGRATION.md#ii1-get-or-create-deposit-address). |
| `transaction_id`   | string | No        | Your checkout / order id (max 256 chars); **200** always returns **`transaction_id`** and **`reference_id`** (same string, yours or generated). Same value on the `created` row and as **`reference_id` / `merchant_transaction_id`** on webhooks. |
| `redirect_url`     | string | No        | Optional HTTPS URL stored with the session and echoed on **200**.                                                                                                                  |
| (headers)          |        | Preferred | `X-Token`, `X-Merchant-Id` — see [MERCHANT_API_INTEGRATION.md — Part I §I.3.1](./MERCHANT_API_INTEGRATION.md#i31-recommended-x-token-secret-not-in-the-json-body).                                                                                                       |

**200** — includes `transaction_id`, `reference_id`, `deposit_scan_expires_at`, `deposit_scan_ttl_minutes`, `reservation_expires_at`, `redirect_url`, `gateway_environment`, and wallet fields. When `amount` was valid, also `expected_amount_atomic` and `expected_amount_decimal`. Open **`created`** checkouts may be **reused** when `transaction_id` / `amount` match (see [MERCHANT_API_INTEGRATION.md — Part II §II.1](./MERCHANT_API_INTEGRATION.md#ii1-get-or-create-deposit-address)).

```json
{
  "address": "T… or 0x…",
  "chain": "TRON",
  "currency": "USDT",
  "network": "TRC20",
  "wallet_id": 1,
  "user_id": 1,
  "merchant_id": 1,
  "created_new_user": false,
  "gateway_environment": "live",
  "transaction_id": "order-789",
  "reference_id": "order-789",
  "deposit_scan_expires_at": null,
  "deposit_scan_ttl_minutes": 120,
  "reservation_expires_at": null,
  "redirect_url": null,
  "expected_amount_atomic": "10500000",
  "expected_amount_decimal": "10.5"
}
```

| Error                           | HTTP | Meaning                                                             |
| ------------------------------- | ---- | ------------------------------------------------------------------- |
| `invalid_api_key`               | 401  | Unknown or inactive merchant key (legacy).                          |
| `invalid_x_token`               | 401  | `X-Token` does not match body / secret.                             |
| `gateway_auth_required`         | 400  | No `api_key` or `X-Token` auth.                                     |
| `rail_not_enabled_for_merchant` | 403  | Rail not in merchant’s supported list.                              |
| `unsupported_currency_network`  | 400  | Unknown pair.                                                       |
| `amount_invalid` (and related)  | 400  | Bad optional `amount`.                                              |
| `amount_not_supported_for_rail` | 400  | `amount` set for a rail without decimal rules.                      |
| `deposit_address_cooldown`      | 429  | Same merchant + `external_user_id` + environment called too soon; body includes `retry_after_seconds`. |
| Missing fields                  | 400  | `external_user_id` required (and gateway auth).                     |

---

### 5.2b List supported currency options

```http
GET /api/v1/gateway/supported-currency
X-Merchant-Id: {merchant numeric id}
X-Token: {see MERCHANT_API_INTEGRATION.md — encrypt canonical {"api_key":"<secret>"}}
```

**200** — `pairs`, `default_currency`, `default_network`, `gateway_environment`, `gateway_tron_usdt_only`. Each entry in `pairs` is `{ "currency", "network", "chain" }` (same rail columns as §4). If `gateway_tron_usdt_only` is true, only **USDT / TRC20** is listed and accepted, even when the merchant saved more rails in the portal.

---

### 5.3 Get transaction (by checkout reference)

```http
GET /api/v1/gateway/transactions?transaction_id={checkout_reference}
```

**Auth:** **`X-Merchant-Id`** + **`X-Token`** (same rules as **`GET /api/v1/gateway/supported-currency`** — encrypt canonical `{"api_key":"<secret>"}`). Optional **`gateway_environment`** query when using one shared key.

**Query:** required **`transaction_id`** only (the string from **deposit-address 200**). Legacy **`address`**, **`reference_id`**, **`currency`**, **`network`**, **`chain`** are rejected with **`400`**.

**200** — one JSON object (same field set as a payment webhook row / former list element): `expected_amount_*`, `received_amount_*`, `checkout`, `received`, legacy `amount` / `amount_decimal` (received), numeric `id` (internal row — same meaning as webhook JSON `transaction_id`), `wallet_id`, string **`transaction_id`** / **`reference_id`**, `external_user_id`, `deposit_session_key`, `gateway_environment`, `status`. **`404 transaction_not_found`** if missing or not owned by this merchant for the environment.

---

## 6. Webhooks (deposits only)

The merchant **callback URL** receives **`POST`** requests for **pay-ins (deposits)** only, with **`X-Webhook-Event: payment`**. For **payout** status, use **`GET /api/v1/gateway/payout?client_reference_id=…`** — see [MERCHANT_API_INTEGRATION.md — Part III §III.2](./MERCHANT_API_INTEGRATION.md#iii2-get-payout-status).

For deposits, JSON **`status`** is `success`, `underpaid`, `pending`, or `failed`. Multiple open checkouts on one wallet: new credits apply **LIFO** to the newest unpaid `created` placeholder. Full field list and retries: [MERCHANT_API_INTEGRATION.md — Part II §II.3](./MERCHANT_API_INTEGRATION.md#ii3-payment-webhooks-x-webhook-event-payment).

Every payment body includes **`expected_amount_atomic`**, **`expected_amount_decimal`**, **`received_amount_atomic`**, and **`received_amount_decimal`**.

**Why `expected_*` is sometimes `null`:** Those fields come from the **optional fixed `amount`** you sent on **`POST .../gateway/deposit-address`**. If you did **not** send `amount` (open checkout — customer may pay any sum), the gateway never stores a checkout target, so **`expected_amount_atomic` / `expected_amount_decimal` are `null`**. That is normal: **`received_*`** still shows what actually arrived on-chain. If you **did** send a valid fixed `amount`, **`expected_*`** is filled from that session (and **`amount` / `amount_decimal`** still mirror **received**, i.e. on-chain credited).

```http
POST {callback_url}
Content-Type: application/json
X-Webhook-Event: payment
```

**Example — `status: success`, open checkout (no fixed `amount` on `deposit-address`)**

```json
{
  "transaction_id": 42,
  "merchant_transaction_id": "order-789",
  "reference_id": "order-789",
  "tx_hash": "0x…",
  "amount": "10000000",
  "token_decimals": 6,
  "amount_decimal": "10",
  "expected_amount_atomic": null,
  "expected_amount_decimal": null,
  "received_amount_atomic": "10000000",
  "received_amount_decimal": "10",
  "checkout": null,
  "received": { "atomic": "10000000", "decimal": "10" },
  "status": "success",
  "chain": "TRON",
  "currency": "USDT",
  "network": "TRC20",
  "token_symbol": "USDT",
  "wallet_address": "T…",
  "confirmations": 20,
  "external_user_id": "your-user-123",
  "merchant_id": 1,
  "gateway_environment": "live"
}
```

**Example — `status: success`, fixed checkout (`deposit-address` included `amount` for 10 USDT, 6 decimals)**

```json
{
  "transaction_id": 43,
  "merchant_transaction_id": "order-790",
  "reference_id": "order-790",
  "tx_hash": "0x…",
  "amount": "10000000",
  "token_decimals": 6,
  "amount_decimal": "10",
  "expected_amount_atomic": "10000000",
  "expected_amount_decimal": "10",
  "received_amount_atomic": "10000000",
  "received_amount_decimal": "10",
  "checkout": { "atomic": "10000000", "decimal": "10" },
  "received": { "atomic": "10000000", "decimal": "10" },
  "status": "success",
  "chain": "TRON",
  "currency": "USDT",
  "network": "TRC20",
  "token_symbol": "USDT",
  "wallet_address": "T…",
  "confirmations": 20,
  "external_user_id": "your-user-123",
  "merchant_id": 1,
  "gateway_environment": "live"
}
```

**Idempotency (payment webhooks):** Use `tx_hash` + `chain` + `wallet_id` (and **`reference_id`** / `merchant_transaction_id` / the **deposit-address** reference string for your order correlation).

**Security:** Add a shared secret or signature at your edge; the default gateway does not sign payloads.

---

## 7. Payout (summary)

```http
POST /api/v1/gateway/payout
GET  /api/v1/gateway/payout?client_reference_id={your_ref}
```

Same gateway auth as deposits. Body: `chain` (`TRON` / `ETH`), `token_symbol` (`USDT`), `to_address`, `amount`, recommended `client_reference_id`. Within limits the gateway **auto-sends** USDT from the merchant treasury or platform hot wallet; **201** is usually already **`completed`** or **`failed`**. No payout webhooks — poll GET by `client_reference_id` if needed. Sandbox: use **`simulate_result`: `"success"` / `"failed"`** (ignored on live). Full reference: [MERCHANT_API_INTEGRATION.md — Part III](./MERCHANT_API_INTEGRATION.md#part-iii-payout).

---

## 8. Default development credentials

After migration + seed (see operator runbook):

| Role     | Email                    | Password          |
| -------- | ------------------------ | ----------------- |
| Admin    | `admin@gateway.local`    | `Admin#ChangeMe1` |
| Merchant | `merchant@gateway.local` | `Merchant#Demo1`  |

**Demo API key** (matches bundled seed): `cpg_live_demo_dev_only_change_me`

**Change all of these before production.**

---

## 9. Portal routes (human UI)

| Audience         | Base path | Use                                                                 |
| ---------------- | --------- | ------------------------------------------------------------------- |
| Admin            | `/admin`  | Merchants CRUD, reseller partners, wallets, settlements, settings.  |
| Merchant         | `/m`      | Dashboard, users, pay-ins, payouts/settlements, wallets, settings.  |
| Reseller partner | `/rp`     | Partner login, assigned merchants, pay-ins / pay-outs / settlements.|

REST for the SPA (Bearer JWT after login — merchant/admin `POST /api/v1/auth/login`, RP uses the RP login route):

- `GET /api/v1/auth/me`
- Admin: `/api/v1/admin/*`
- Merchant: `/api/v1/merchant/*`
- Reseller partner: `/api/v1/rp/*`

---

## 10. Versioning

Integrators should target `**/api/v1/...`\*\* prefixes. Breaking changes will bump the major version or be announced in advance.
