# Merchant API integration guide

This document is for **merchants** who use the **merchant portal** (`/m`) and need their **own backend or app** to accept crypto deposits via the gateway.

There are **two separate auth mechanisms**:

| Use case                                                               | How you authenticate                                                                        | Base paths                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Browser portal** (dashboard, settings, reports)                      | **JWT** after email/password login                                                          | `/api/v1/auth/*`, `/api/v1/merchant/*` |
| **Your server calling the gateway** (deposit addresses, status polling) | **`X-Token` + `X-Merchant-Id` headers** (recommended), or legacy **`api_key`** in JSON body | `/api/v1/gateway/*`                    |

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

Returns your profile fields used by the UI, including `defaultChains`, `defaultCurrency`, `defaultNetwork`, `supportedDepositRails`, `callbackUrl`, `apiKeyHint` (last characters of the key only — **not** the secret). Also **`gateway_tron_usdt_only`** (boolean) and **`gateway_supported_rail_keys`** (string array like `["USDT|TRC20",…]`): the rails the **gateway API** will actually accept — same as `GET /api/v1/gateway/supported-currency` when using your key. These can be a **subset** of `supportedDepositRails` while `gateway_tron_usdt_only` is true.

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

| Setting                                                             | Effect on integration                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Callback URL**                                                    | HTTPS URL for **payment** webhooks: same `X-Webhook-Event` for every POST; use JSON **`status`** to branch (`success`, `underpaid`, …). See §6.                                                                                                                             |
| **Supported chains**                                                | Underlying chains the gateway may use. Each deposit **rail** must belong to one of these chains.                                                                                                                                                                            |
| **Supported currency / network (rails)**                            | Whitelist of `(currency, network)` pairs your API key may use (e.g. `USDT` + `TRC20`). If this list is **non-empty**, requests for other pairs return `rail_not_enabled_for_merchant`. If the list is **empty** (legacy), any gateway rail on a supported chain is allowed. |
| **Default pair** (stored as `default_currency` / `default_network`) | Set automatically from the **first** rail in your supported list when you save settings. Used when `deposit-address` is called **without** `currency` and `network`.                                                                                                        |

**Important:** Put the rail you want as the default **first** in the supported list (selection order in the UI defines the array order).

---

## 3. Merchant API key (gateway)

- Issued when an **admin** creates the merchant or when you **regenerate** the key (old key stops working).
- Shown **once** in the admin UI or modal — store it in **secrets** (environment variables, vault), not in git or frontend bundles.
- Gateway POST routes accept either **recommended header auth** (`X-Token`) or **legacy** JSON field **`api_key`**. No `Authorization` JWT is required for `/api/v1/gateway/*` (that JWT is for the browser portal only).

### 3.1 Recommended: `X-Token` (secret not in the JSON body)

For **POST** routes, send the **same JSON body as before but omit `api_key`**, and add headers below. **Live vs sandbox** defaults to the merchant **portal profile** (Settings); omit `gateway_environment` in JSON unless you need an override when live and sandbox share one secret.

| Header          | Value                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `X-Merchant-Id` | Your numeric merchant id (positive integer). Same as `id` from `GET /api/v1/auth/me` when logged into the merchant portal. |
| `X-Token`       | Base64 string: **AES-256-GCM** encryption of the **canonical JSON** of the request body (UTF-8 plaintext).                 |

**Canonical JSON:** at every object level, sort keys **lexicographically**; serialize with no extra whitespace (standard `JSON`-style primitives). Arrays keep element order. The string you encrypt must be **exactly** this canonical form of the body the server will parse (after `Content-Type: application/json` decoding).

**Match JavaScript `JSON.stringify`:** The gateway compares your decrypted plaintext to **`JSON.stringify`-compatible output** (Node’s canonical serializer). In **PHP**, `json_encode()` escapes `/` as `\/` by default; JavaScript does **not**. Use **`JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES`** on **every** `json_encode` in your canonical serializer **and** when encoding the raw POST body, or requests with URLs (e.g. `redirect_url`) fail with `invalid_x_token`. Python’s `json.dumps`, Go’s `json.Marshal`, Ruby’s `JSON.generate`, etc. already align with this for typical strings; when in doubt, compare your canonical string to the same object in Node.

**POST body:** Send the JSON body with header **`Content-Type: application/json`**. The wire body must deserialize to the same values you used to build the canonical string for `X-Token`.

**Key material:** derive a 32-byte AES key as **SHA-256** (binary digest) of the merchant API secret string (UTF-8). Use **AES-256-GCM** with a random 12-byte IV per request; append the 16-byte GCM auth tag; wire format is **base64**( `IV || tag || ciphertext` ) (12 + 16 + ciphertext length).

The server decrypts `X-Token` with your stored gateway secret and checks that the plaintext **equals** the canonical JSON of the received body. If not, the call fails with `invalid_x_token` (tampering or wrong secret). Do **not** send `api_key` in the body when using `X-Token` on **POST** routes (you would get `ambiguous_gateway_auth`).

**GET** `/api/v1/gateway/supported-currency` has no body: build `X-Token` from canonical JSON `{"api_key":"<your_secret>"}` only (secret encrypted inside the token, not sent as plain text).

### 3.2 Legacy: `api_key` in the JSON body

You may still pass **`api_key`** in the body on the same routes. New integrations should prefer **`X-Token`** so the secret is not embedded in JSON logs or proxies.

---

## 4. Supported deposit rails (gateway)

These `(currency, network)` pairs are accepted when they resolve to a known rail **and** your merchant is allowed to use them (see §2).

| `currency` | `network` | Chain |
| ---------- | --------- | ----- |
| `USDT`     | `TRC20`   | TRON  |
| `USDT`     | `ERC20`   | ETH   |
| `USDT`     | `TON`     | TON   |
| `USDT`     | `BEP20`   | BNB   |
| `TRX`      | `TRON`    | TRON  |

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

**200** — `{ "pairs": [...], "default_currency", "default_network", "gateway_environment", "gateway_tron_usdt_only" }`. Each `pairs[]` object includes `currency`, `network`, and `chain` (underlying chain code, same meaning as `deposit-address` responses). When `gateway_tron_usdt_only` is **true** (default in many deployments), the gateway only allows **USDT + TRC20** regardless of how many rails you saved in Settings — `pairs` will contain that one rail only until an admin sets `GATEWAY_TRON_USDT_ONLY` to **false** / **0** (env or System settings) and the API process is restarted if needed.

### 5.1 Get or create deposit address

```http
POST /api/v1/gateway/deposit-address
```

| Field                 | Required       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api_key`             | Legacy only    | Merchant API secret; omit when using `X-Token` + `X-Merchant-Id`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `external_user_id`    | Yes            | Stable unique id of the payer on **your** system.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `currency`            | No             | e.g. `USDT`. If omitted, merchant **default** pair is used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `network`             | No             | e.g. `TRC20`. If omitted, merchant **default** pair is used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `amount`              | No             | **Optional fixed checkout amount.** Either a **decimal token amount** (e.g. `"10.50"`) or **digits-only whole token units** (e.g. `"11"` = 11 USDT, scaled by the rail’s decimals). When set, the gateway stores it for this checkout session and treats the deposit as **underpaid** until the **sum of on-chain credits for this checkout session** reaches the expected total (within a one–smallest-unit tolerance). Omit `amount` for the classic “pay any amount” flow. Supported for rails where the gateway knows token decimals (today: **USDT** on **TRC20**, **ERC20**, **BEP20**). |
| `transaction_id`      | No             | Your order / checkout id (stored on new deposit rows). Max 256 characters. If omitted, the gateway generates a unique reference. **200** returns it as **`transaction_id`** and duplicate **`reference_id`** (same string everywhere: `created` row, `GET …/gateway/transactions?transaction_id=…` response, webhooks `reference_id` / `merchant_transaction_id`).                                                                                                                                                                                                                                                                                                                                                                                    |
| `redirect_url`        | No             | Optional HTTPS URL stored with the session and echoed on **200** for your own post-pay flows (HTTPS allowlist).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `gateway_environment` | No             | **Omit** to use the merchant portal **Live/Sandbox** setting (Settings). Optional override only when live and sandbox share one secret and you need the other environment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Headers               | With `X-Token` | `X-Token` (required), `X-Merchant-Id` (required).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**200** — always includes `address`, `chain`, `currency`, `network`, numeric `wallet_id`, `user_id`, `merchant_id`, `created_new_user`, `gateway_environment`, **`transaction_id`** and **`reference_id`** (same checkout reference string — your optional id or gateway-generated; use either field), `deposit_scan_expires_at`, `deposit_scan_ttl_minutes`, `reservation_expires_at`, and `redirect_url` (echo, may be `null`).

When `amount` was sent and parsed, the response also includes `expected_amount_atomic` and `expected_amount_decimal` (human-readable for display). Every **`deposit-address`** call inserts a **`transactions` row** with `status: "created"` (placeholder `amount` `0`, synthetic `tx_hash` `gateway-created:<session>`, `reference_transaction_id` set to that **`transaction_id`**) — **even when no optional `amount`** was sent, so you can track the checkout from the response onward. The placeholder is removed when the first on-chain credit exists for that checkout session. If the payer never sends funds and the row stays `created` longer than **`CHECKOUT_CREATED_EXPIRY_HOURS`** (default **24**, `.env` or Admin → System settings under **Checkout · abandoned fixed-amount**), the maintenance cron marks it **`failed`** and POSTs a **payment** webhook with `status: "failed"` (see §6) so you can cancel the order on your side.

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
  "deposit_scan_expires_at": "2026-01-01T12:00:00.000Z",
  "deposit_scan_ttl_minutes": 120,
  "reservation_expires_at": "2026-01-01T11:00:00.000Z",
  "redirect_url": "https://merchant.example.com/thanks",
  "expected_amount_atomic": "10500000",
  "expected_amount_decimal": "10.5"
}
```

| HTTP | `error`                                                                               | Meaning                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400  | `gateway_auth_required`                                                               | Neither `api_key` nor `X-Token` auth provided.                                                                                                                                                                     |
| 400  | `x_merchant_id_required`                                                              | `X-Token` sent without `X-Merchant-Id`.                                                                                                                                                                            |
| 400  | `ambiguous_gateway_auth`                                                              | Both `api_key` and `X-Token` sent.                                                                                                                                                                                 |
| 400  | (message)                                                                             | Missing `external_user_id`, or unsupported pair.                                                                                                                                                                   |
| 400  | `amount_invalid` / `amount_must_be_positive` / `amount_too_long` / `amount_too_large` | Bad `amount` string.                                                                                                                                                                                               |
| 400  | `amount_not_supported_for_rail`                                                       | `amount` sent but this `currency`/`network` has no fixed-decimal rules in the gateway (use omit or another rail).                                                                                                  |
| 401  | `invalid_api_key`                                                                     | Bad or inactive key (legacy body auth).                                                                                                                                                                            |
| 401  | `invalid_x_token`                                                                     | Token does not match body / secret.                                                                                                                                                                                |
| 401  | `invalid_x_merchant_id`                                                               | Unknown or inactive merchant id.                                                                                                                                                                                   |
| 503  | `gateway_secret_unavailable`                                                          | Server cannot verify `X-Token` (missing cipher; regenerate key).                                                                                                                                                   |
| 403  | `rail_not_enabled_for_merchant`                                                       | Pair not in your supported rails (when configured).                                                                                                                                                                |
| 400  | `unsupported_currency_network`                                                        | Unknown `currency`/`network` combination.                                                                                                                                                                          |
| 429  | `deposit_address_cooldown`                                                              | Operator limit: another successful `deposit-address` for this **same** merchant + `external_user_id` + gateway environment was too recent. Body includes **`retry_after_seconds`** (and a **`message`**) — wait, then retry. Tunable via **`GATEWAY_DEPOSIT_ADDRESS_COOLDOWN_SEC`** (Admin → **Gateway** / `.env`; `0` = off). |

Idempotent: same merchant + `external_user_id` + same `(currency, network)` returns the same wallet. Each successful `deposit-address` call still logs a new **checkout session** when the pool assigns or refreshes the row; optional `amount` applies to that session only. For another rail for the same end user, call **`deposit-address` again** with the same **`external_user_id`** and the desired **`currency`** / **`network`** (unless a configured per-user **cooldown** blocks a second call until **`retry_after_seconds`** has passed — see **429** above).

### 5.2 Get transaction by checkout reference

```http
GET /api/v1/gateway/transactions?transaction_id={checkout_reference}
```

**Auth (required):** same as **`GET /api/v1/gateway/supported-currency`** — headers **`X-Merchant-Id`** and **`X-Token`** where **`X-Token`** is AES-GCM of canonical JSON exactly `{"api_key":"<your_gateway_secret>"}` (see §3). Optional query **`gateway_environment=live|sandbox`** when using one shared key (same as supported-currency).

**Query:** only **`transaction_id`** — the checkout reference string returned as **`transaction_id`** / **`reference_id`** on **`deposit-address` 200** (your optional id or gateway-generated hex). Do not send **`address`**, **`reference_id`**, **`currency`**, **`network`**, or **`chain`** (removed; **`400 unsupported_query_param`** if any are present).

**200** — a **single JSON object** (not wrapped in `transactions`), same fields as before each list element: numeric **`id`** (internal row id — same meaning as webhook **`transaction_id`**), **`wallet_id`**, string **`transaction_id`** / **`reference_id`**, **`external_user_id`**, **`deposit_session_key`**, **`gateway_environment`**, and the **same amount fields as payment webhooks**. **`404 transaction_not_found`** if the reference is unknown or not yours for the authenticated environment.

---

## 6. Webhooks (unified `payment` event)

The gateway does not sign webhooks by default — protect your endpoint (secret token in URL, mTLS, or IP allowlist). Treat delivery as **at-least-once**; dedupe with `tx_hash` + `chain` + `wallet_id` (and `log_index` / event id semantics for multi-log chains).

All automatic and manual payment callbacks use the **same** header:

```http
POST {callback_url}
Content-Type: application/json
X-Webhook-Event: payment
```

**Branch on JSON `status`:**

| `status`    | When                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `success`   | Deposit row is successful (full confirmations; for fixed-amount sessions, session total met).                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `underpaid` | You sent optional **`amount`** on `deposit-address`; an on-chain credit exists for this checkout session but the **session total** is still below the expected total (after tolerance). Body adds **`expected_amount_atomic`**, **`expected_amount_decimal`**, **`received_amount_atomic`**, **`received_amount_decimal`**. Prompt top-up or cancel on your side.                                                                                                                                                              |
| `failed`    | The gateway moved the row out of a terminal non-payment state — used when a **`created`** checkout placeholder (any `deposit-address` call) stayed unpaid past **`CHECKOUT_CREATED_EXPIRY_HOURS`** (tunable in Admin → **Checkout · abandoned fixed-amount** / `.env`). Body matches the usual shape with `status: "failed"` and includes **`failure_reason`: `"checkout_expired_unpaid"`** so you can mark the checkout cancelled server-side. Same retry rules as other payment webhooks until your endpoint returns **2xx**. |
| `pending`   | May appear on payloads tied to in-progress rows where applicable.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

When later transfers bring a fixed-amount **session** total to the expected value, you receive another POST with `status: success` (for the transaction that completed the threshold); earlier `underpaid` rows for the same session may be updated to `success` in the database without another underpaid delivery.

Common body fields (success, underpaid, and failed): `transaction_id` (numeric gateway row id), **`reference_id`** and **`merchant_transaction_id`** (duplicate checkout reference string — same as **`reference_id` / `transaction_id`** on **`deposit-address` 200** and on **`GET …/gateway/transactions?transaction_id=…` 200**), flat `expected_amount_*` / `received_amount_*`, nested **`checkout`** / **`received`**, legacy `amount` / `amount_decimal` (= received), `tx_hash`, `chain`, `currency`, `network`, `token_symbol`, `wallet_address`, `confirmations`, `external_user_id`, `merchant_id`, `gateway_environment`. Atomic amounts are JSON strings (digits-only).

### 6.1 New `deposit-address` while webhooks are stuck

If a **payment** webhook (`status` **success**, **underpaid**, or **failed**) has not been acknowledged with **`2xx`**, the gateway **still retries** delivery (same limits as before). **`deposit-address` is not blocked** for that payer — implement **idempotent** webhook handling and reconcile from **`GET …/gateway/transactions`** when needed.

---

## 7. Minimal integration checklist

1. Log in to `/m`, set **callback URL**, **chains**, and **supported rails** (order = default rail first).
2. Store **`api_key`** from admin onboarding in server-side secrets; note your **`id`** from `GET /api/v1/auth/me` for `X-Merchant-Id` when using header auth.
3. On checkout, call **`deposit-address`** with `external_user_id` and optionally `currency` / `network`, optional **`amount`** (fixed price), optional **`transaction_id`** / **`redirect_url`**, using **`X-Token`** (recommended) or legacy **`api_key`** in the body. Persist the returned **`reference_id`** (or **`transaction_id`**) string for support and correlation (same value on webhooks as **`reference_id` / `merchant_transaction_id`** and on **`GET …/gateway/transactions?transaction_id=…`**).
4. Show the user the returned **`address`** and the correct **`network`** label (e.g. TRC20 vs ERC20), and the **amount due** when you passed optional **`amount`** on **`deposit-address`**.
5. Handle **`POST` callback** with `X-Webhook-Event: payment` and **`body.status`** (`success`, `underpaid`, or `failed`); treat delivery as **at-least-once** (dedupe by `tx_hash` + `chain` + `wallet_id` / `log_index` as documented).

---

## 8. Related docs

- [CLIENT_INTEGRATION.md](./CLIENT_INTEGRATION.md) — third-party overview (being aligned with this guide).
- Operator: runbook in repo root / `server` workspace for migrate, seed, env vars.

---

## 9. Development quick reference

After seed (see `.env` / operator docs):

| Item           | Example                                     |
| -------------- | ------------------------------------------- |
| Merchant login | `merchant@gateway.local` / `Merchant#Demo1` |
| Demo API key   | `cpg_live_demo_dev_only_change_me`          |

Change passwords and rotate API keys before production.
