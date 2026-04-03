/**
 * Reference implementations for gateway X-Token (canonical JSON + AES-256-GCM + SHA-256 key).
 * Must match server: `server/src/lib/gateway-x-token.js`
 * PHP: every json_encode in canonical JSON must include JSON_UNESCAPED_SLASHES (see MERCHANT_API_INTEGRATION.md §3.1).
 *
 * @typedef {{ id: string, label: string, code: string }} XTokenSnippet
 */

/** @type {XTokenSnippet[]} */
export const GATEWAY_X_TOKEN_SNIPPETS = [
  {
    id: "nodejs",
    label: "Node.js",
    code: `// npm: built-in crypto (Node.js)
const crypto = require("crypto");

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
    return \`[\${value.map((v) => canonicalJsonStringify(v)).join(",")}]\`;
  }
  const keys = Object.keys(value).sort();
  return \`{\${keys
    .map((k) => \`\${JSON.stringify(k)}:\${canonicalJsonStringify(value[k])}\`)
    .join(",")}}\`;
}

function buildXToken(bodyObject, merchantApiSecret) {
  const plain = canonicalJsonStringify(bodyObject);
  const key = crypto.createHash("sha256").update(merchantApiSecret, "utf8").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}`,
  },
  {
    id: "python",
    label: "Python 3",
    code: `# pip install pycryptodome
import base64
import hashlib
import json
import os
from Cryptodome.Cipher import AES

def canonical_json_stringify(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int) and not isinstance(value, bool):
        return json.dumps(value, separators=(",", ":"))
    if isinstance(value, float):
        if not (value == value) or value in (float("inf"), float("-inf")):
            raise ValueError("non-finite number")
        return json.dumps(value, separators=(",", ":"))
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        inner = ",".join(canonical_json_stringify(v) for v in value)
        return "[" + inner + "]"
    if isinstance(value, dict):
        keys = sorted(value.keys(), key=lambda k: str(k))
        parts = []
        for k in keys:
            parts.append(
                json.dumps(str(k), ensure_ascii=False, separators=(",", ":"))
                + ":"
                + canonical_json_stringify(value[k])
            )
        return "{" + ",".join(parts) + "}"
    raise ValueError("unsupported type")

def build_x_token(body_obj: dict, merchant_api_secret: str) -> str:
    plain = canonical_json_stringify(body_obj).encode("utf-8")
    key = hashlib.sha256(merchant_api_secret.encode("utf-8")).digest()
    iv = os.urandom(12)
    cipher = AES.new(key, AES.MODE_GCM, nonce=iv)
    ciphertext, tag = cipher.encrypt_and_digest(plain)
    blob = iv + tag + ciphertext
    return base64.b64encode(blob).decode("ascii")`,
  },
  {
    id: "php",
    label: "PHP",
    code: `<?php
// PHP 8.1+ (array_is_list). OpenSSL ext required.
// Use JSON_UNESCAPED_SLASHES on every json_encode: PHP escapes "/" by default; Node JSON.stringify does not (URLs in bodies).

function canonical_json_stringify($v) {
    if ($v === null) return "null";
    if (is_bool($v)) return $v ? "true" : "false";
    if (is_int($v)) return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (is_float($v)) {
        if (is_nan($v) || is_infinite($v)) throw new Exception("non-finite number");
        return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
    if (is_string($v)) return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (is_array($v)) {
        if (array_is_list($v)) {
            $parts = array_map("canonical_json_stringify", $v);
            return "[" . implode(",", $parts) . "]";
        }
        ksort($v);
        $parts = [];
        foreach ($v as $k => $val) {
            $parts[] = json_encode((string)$k, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . ":" . canonical_json_stringify($val);
        }
        return "{" . implode(",", $parts) . "}";
    }
    throw new Exception("unsupported type");
}

function build_x_token(array $body, string $merchantSecret) {
    $plain = canonical_json_stringify($body);
    $key = hash("sha256", $merchantSecret, true);
    $iv = random_bytes(12);
    $tag = "";
    $ciphertext = openssl_encrypt($plain, "aes-256-gcm", $key, OPENSSL_RAW_DATA, $iv, $tag, "", 16);
    if ($ciphertext === false) throw new Exception("encrypt failed");
    $blob = $iv . $tag . $ciphertext;
    return base64_encode($blob);
}`,
  },
  {
    id: "go",
    label: "Go",
    code: `package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
)

func canonicalJSONStringify(v interface{}) (string, error) {
	switch x := v.(type) {
	case nil:
		return "null", nil
	case bool:
		if x {
			return "true", nil
		}
		return "false", nil
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return "", fmt.Errorf("non-finite number")
		}
		b, err := json.Marshal(x)
		return string(b), err
	case string:
		b, err := json.Marshal(x)
		return string(b), err
	case []interface{}:
		var parts []string
		for _, el := range x {
			s, err := canonicalJSONStringify(el)
			if err != nil {
				return "", err
			}
			parts = append(parts, s)
		}
		return "[" + strings.Join(parts, ",") + "]", nil
	case map[string]interface{}:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var parts []string
		for _, k := range keys {
			ks, err := json.Marshal(k)
			if err != nil {
				return "", err
			}
			vs, err := canonicalJSONStringify(x[k])
			if err != nil {
				return "", err
			}
			parts = append(parts, string(ks)+":"+vs)
		}
		return "{" + strings.Join(parts, ",") + "}", nil
	default:
		return "", fmt.Errorf("unsupported type")
	}
}

func buildXToken(body map[string]interface{}, merchantSecret string) (string, error) {
	plain, err := canonicalJSONStringify(body)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256([]byte(merchantSecret))
	block, err := aes.NewCipher(h[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, nonce, []byte(plain), nil)
	tagLen := gcm.Overhead()
	ct := sealed[:len(sealed)-tagLen]
	tag := sealed[len(sealed)-tagLen:]
	blob := append(append(append([]byte{}, nonce...), tag...), ct...)
	return base64.StdEncoding.EncodeToString(blob), nil
}`,
  },
  {
    id: "ruby",
    label: "Ruby",
    code: `# gem: openssl (stdlib). Use Hash with String keys (e.g. from JSON.parse).
require "openssl"
require "json"
require "digest"
require "base64"

def canonical_json_stringify(value)
  case value
  when NilClass then "null"
  when TrueClass then "true"
  when FalseClass then "false"
  when Integer, Float
    raise "non-finite number" if value.is_a?(Float) && (!value.finite?)
    JSON.generate(value)
  when String then JSON.generate(value)
  when Array
    "[" + value.map { |v| canonical_json_stringify(v) }.join(",") + "]"
  when Hash
    h = value.transform_keys(&:to_s)
    keys = h.keys.sort
    parts = keys.map { |k| JSON.generate(k) + ":" + canonical_json_stringify(h[k]) }
    "{" + parts.join(",") + "}"
  else
    raise "unsupported type"
  end
end

def build_x_token(body_obj, merchant_api_secret)
  plain = canonical_json_stringify(body_obj)
  key = Digest::SHA256.digest(merchant_api_secret)
  cipher = OpenSSL::Cipher.new("aes-256-gcm")
  cipher.encrypt
  cipher.key = key
  iv = OpenSSL::Random.random_bytes(12)
  cipher.iv = iv
  enc = cipher.update(plain) + cipher.final
  tag = cipher.auth_tag
  blob = iv + tag + enc
  Base64.strict_encode64(blob)
end`,
  },
  {
    id: "java",
    label: "Java",
    code: `// Java 11+ (javax.crypto). Gradle: implementation "com.google.code.gson:gson:2.10.1"

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;
import java.util.stream.Collectors;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

public final class GatewayXToken {
  private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

  @SuppressWarnings("unchecked")
  public static String canonicalJsonStringify(Object v) {
    if (v == null) return "null";
    if (v instanceof Boolean) return (Boolean) v ? "true" : "false";
    if (v instanceof Number) {
      double d = ((Number) v).doubleValue();
      if (Double.isNaN(d) || Double.isInfinite(d)) throw new IllegalArgumentException("non-finite");
      return GSON.toJson(v);
    }
    if (v instanceof String) return GSON.toJson(v);
    if (v instanceof List) {
      List<?> list = (List<?>) v;
      return list.stream().map(GatewayXToken::canonicalJsonStringify).collect(Collectors.joining(",", "[", "]"));
    }
    if (v instanceof Map) {
      Map<?, ?> m = (Map<?, ?>) v;
      List<String> keys = m.keySet().stream().map(Object::toString).sorted().collect(Collectors.toList());
      String inner = keys.stream()
          .map(k -> GSON.toJson(k) + ":" + canonicalJsonStringify(m.get(k)))
          .collect(Collectors.joining(","));
      return "{" + inner + "}";
    }
    throw new IllegalArgumentException("unsupported type");
  }

  public static String buildXToken(Map<String, Object> body, String merchantSecret) throws Exception {
    String plain = canonicalJsonStringify(body);
    byte[] key = MessageDigest.getInstance("SHA-256").digest(merchantSecret.getBytes(StandardCharsets.UTF_8));
    byte[] iv = new byte[12];
    new SecureRandom().nextBytes(iv);
    Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
    c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
    byte[] combined = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
    int ctLen = combined.length - 16;
    byte[] ct = Arrays.copyOf(combined, ctLen);
    byte[] tag = Arrays.copyOfRange(combined, ctLen, combined.length);
    byte[] blob = new byte[iv.length + tag.length + ct.length];
    System.arraycopy(iv, 0, blob, 0, iv.length);
    System.arraycopy(tag, 0, blob, iv.length, tag.length);
    System.arraycopy(ct, 0, blob, iv.length + tag.length, ct.length);
    return Base64.getEncoder().encodeToString(blob);
  }
}`,
  },
  {
    id: "csharp",
    label: "C#",
    code: `// .NET 5+ (System.Security.Cryptography.AesGcm). Use Dictionary<string, object> and List<object>.

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Collections.Generic;
using System.Linq;

public static class GatewayXToken
{
    public static string CanonicalJsonStringify(object? v)
    {
        if (v == null) return "null";
        if (v is bool b) return b ? "true" : "false";
        if (v is string s) return JsonSerializer.Serialize(s);
        if (v is byte or sbyte or short or ushort or int or uint or long or ulong)
            return JsonSerializer.Serialize(v);
        if (v is float or double)
        {
            double d = Convert.ToDouble(v);
            if (double.IsNaN(d) || double.IsInfinity(d)) throw new ArgumentException("non-finite");
            return JsonSerializer.Serialize(d);
        }
        if (v is decimal dec) return JsonSerializer.Serialize(dec);
        if (v is List<object> list)
            return "[" + string.Join(",", list.Select(CanonicalJsonStringify)) + "]";
        if (v is Dictionary<string, object> map)
        {
            var keys = map.Keys.Order(StringComparer.Ordinal).ToList();
            return "{" + string.Join(",", keys.Select(k =>
                JsonSerializer.Serialize(k) + ":" + CanonicalJsonStringify(map[k]))) + "}";
        }
        throw new ArgumentException("unsupported type");
    }

    public static string BuildXToken(Dictionary<string, object> body, string merchantSecret)
    {
        var plain = CanonicalJsonStringify(body);
        var plainBytes = Encoding.UTF8.GetBytes(plain);
        var key = SHA256.HashData(Encoding.UTF8.GetBytes(merchantSecret));
        var iv = new byte[12];
        RandomNumberGenerator.Fill(iv);
        var tag = new byte[16];
        var ct = new byte[plainBytes.Length];
        using (var aes = new AesGcm(key))
            aes.Encrypt(iv, plainBytes, ct, tag);
        var blob = new byte[12 + 16 + ct.Length];
        Buffer.BlockCopy(iv, 0, blob, 0, 12);
        Buffer.BlockCopy(tag, 0, blob, 12, 16);
        Buffer.BlockCopy(ct, 0, blob, 28, ct.Length);
        return Convert.ToBase64String(blob);
    }
}`,
  },
];
