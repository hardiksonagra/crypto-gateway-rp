const crypto = require("crypto");
const axios = require("axios");

function canonicalJsonStringify(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number");
    return JSON.stringify(value);
  }
  if (t === "boolean" || t === "string") return JSON.stringify(value);
  if (t !== "object") throw new Error("unsupported type");
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJsonStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(value[k])}`)
    .join(",")}}`;
}

function buildXToken(bodyObject, merchantApiSecret) {
  const plain = canonicalJsonStringify(bodyObject);
  const key = crypto
    .createHash("sha256")
    .update(merchantApiSecret, "utf8")
    .digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

const MERCHANT_SECRET = "cpg_c7290336ba915ce2d67f7d23ceed9d020714f4541cea8289";
const URL = "http://localhost:3000/api/v1/gateway/deposit-address";

async function makeCalls() {
  for (let i = 101; i <= 120; i++) {
    const body = {
      external_user_id: `harry${i}`,
      currency: "USDT",
      network: "TRC20",
      redirect_url: "https://google.com",
      amount: 1.78,
    };

    const token = buildXToken(body, MERCHANT_SECRET);

    try {
      const res = await axios.post(URL, body, {
        headers: {
          "Content-Type": "application/json",
          "X-Token": token,
          "X-Merchant-Id": "1",
        },
      });

      console.log(`✅ harry${i}:`, res.data);
    } catch (err) {
      console.log(`❌ harry${i}:`, err.response?.data || err.message);
    }
  }
}

makeCalls();
