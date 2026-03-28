# Crypto Payment Gateway — Third-party integration (v1)

Share your **HTTPS base URL** (e.g. `https://payments.example.com`) with integrators. All paths below are **relative** to that base.

**Merchants** using the portal and integrating their backend should also read **[MERCHANT_API_INTEGRATION.md](./MERCHANT_API_INTEGRATION.md)** (JWT login vs `api_key`, settings, rails).

---

## 1. Overview


| Item               | Description                                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**        | Issue **per-customer deposit addresses**, detect incoming transfers, and **POST webhooks** to the merchant’s configured callback URL when a payment is confirmed.                                                                                                   |
| **Format**         | JSON over HTTPS (`Content-Type: application/json`)                                                                                                                                                                                                                  |
| **Authentication** | `**api_key`** on gateway routes identifies the **merchant**. Keys are created in the **admin portal** when a merchant is provisioned (shown **once**).                                                                                                              |
| **Rails**          | Deposits are identified by `**currency`** + `**network`** (e.g. `USDT` + `TRC20`). Merchants configure **supported chains** and **supported rails** in the portal; if omitted on `deposit-address`, the merchant’s **default** pair is used (first supported rail). |


---

## 2. Flow

1. Merchant configures **callback URL**, **supported chains**, and **supported currency/network rails** in the portal (`/m/settings`).
2. Integrator calls `**POST /api/v1/gateway/deposit-address`** with `api_key` + `external_user_id`, and optionally `currency` + `network`.
3. Response includes `address`, `chain`, `currency`, `network` (idempotent per customer + rail).
4. Optional: `**POST /api/v1/gateway/create-wallet`** with `api_key`, `user_id`, `currency`, and `network` for another rail for the same user.
5. User sends crypto to the shown address on the **correct network**.
6. When confirmations pass, the gateway POSTs `**payment.success`** to the merchant **callback URL**.

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


| Field              | Type   | Required | Description                                                          |
| ------------------ | ------ | -------- | -------------------------------------------------------------------- |
| `api_key`          | string | Yes      | Merchant API secret (`cpg_live_…`).                                  |
| `external_user_id` | string | Yes      | Stable unique id of the payer on **your** system.                    |
| `currency`         | string | No       | Upper-case token symbol (e.g. `USDT`). Defaults to merchant default. |
| `network`          | string | No       | Network label (e.g. `TRC20`). Defaults to merchant default.          |


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


| Error                           | HTTP | Meaning                                    |
| ------------------------------- | ---- | ------------------------------------------ |
| `invalid_api_key`               | 401  | Unknown or inactive merchant key.          |
| `rail_not_enabled_for_merchant` | 403  | Rail not in merchant’s supported list.     |
| `unsupported_currency_network`  | 400  | Unknown pair.                              |
| Missing fields                  | 400  | `api_key` and `external_user_id` required. |


---

### 5.3 Create wallet (another rail)

```http
POST /api/v1/gateway/create-wallet
Content-Type: application/json
```


| Field      | Type   | Required | Description                      |
| ---------- | ------ | -------- | -------------------------------- |
| `api_key`  | string | Yes      | Merchant API secret.             |
| `user_id`  | string | Yes      | From `deposit-address` response. |
| `currency` | string | Yes      | e.g. `USDT`                      |
| `network`  | string | Yes      | e.g. `ERC20`                     |


**200** — `{ "address": "…", "chain": "ETH", "currency": "USDT", "network": "ERC20", "wallet_id": "cl…" }`

**404** — `user not found` if `user_id` does not belong to this merchant.

---

### 5.4 Transaction history (by deposit address)

```http
GET /api/v1/gateway/transactions?address={deposit_address}
```

Optional: `currency` and `network` query params (both required to filter by rail).

Up to **200** recent rows; `amount` is in **smallest units**; use `token_decimals` for display.

---

## 6. Webhooks (`payment.success`)

When a row reaches `**success`**, the gateway POSTs once (with retries until `2xx`) to the merchant’s `**callback_url`**.

```http
POST {callback_url}
Content-Type: application/json
X-Webhook-Event: payment.success
```

**Example body**

```json
{
  "tx_hash": "0x…",
  "amount": "1000000",
  "status": "success",
  "chain": "TRON",
  "token_symbol": "USDT",
  "wallet_address": "T…",
  "confirmations": 20,
  "external_user_id": "your-user-123",
  "merchant_id": "cl…"
}
```

**Idempotency:** Use `tx_hash` + `chain` + `token_symbol` + `wallet_address` (and your own payment id if any).

**Security:** Add a shared secret or signature at your edge; the default gateway does not sign payloads.

---

## 7. Default development credentials

After migration + seed (see operator runbook):


| Role     | Email                    | Password          |
| -------- | ------------------------ | ----------------- |
| Admin    | `admin@gateway.local`    | `Admin#ChangeMe1` |
| Merchant | `merchant@gateway.local` | `Merchant#Demo1`  |


**Demo API key** (matches bundled seed): `cpg_live_demo_dev_only_change_me`

**Change all of these before production.**

---

## 8. Portal routes (human UI)


| Audience | Base path | Use                                                          |
| -------- | --------- | ------------------------------------------------------------ |
| Admin    | `/admin`  | Merchants CRUD, all users & transactions, dashboard.         |
| Merchant | `/m`      | Dashboard, own users & txs, withdraw (EVM native), settings. |


REST for the SPA (Bearer JWT after `POST /api/v1/auth/login`):

- `GET /api/v1/auth/me`
- Admin: `/api/v1/admin/`*
- Merchant: `/api/v1/merchant/*`

---

## 9. Versioning

Integrators should target `**/api/v1/...`** prefixes. Breaking changes will bump the major version or be announced in advance.