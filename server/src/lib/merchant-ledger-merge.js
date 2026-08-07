import { Prisma } from "@prisma/client";

/**
 * @param {string} statusUi portal filter (`created` | `pending` | `success` | `failed` | `underpaid` | "")
 * @returns {Prisma.Sql}
 */
function depositStatusSql(statusUi) {
  const s = String(statusUi ?? "").trim().toLowerCase();
  if (!s) return Prisma.sql`TRUE`;
  const ok = ["created", "pending", "success", "failed", "underpaid"];
  if (!ok.includes(s)) return Prisma.sql`TRUE`;
  return Prisma.sql`t.status = ${s}::"TxStatus"`;
}

/**
 * @param {string} statusUi same labels; `success` maps to withdrawal `completed`.
 * @returns {Prisma.Sql}
 */
function payoutStatusSql(statusUi) {
  const s = String(statusUi ?? "").trim().toLowerCase();
  if (!s) return Prisma.sql`TRUE`;
  if (s === "created" || s === "underpaid") return Prisma.sql`FALSE`;
  if (s === "pending") {
    return Prisma.sql`wd.status IN ('pending'::"WithdrawalStatus", 'processing'::"WithdrawalStatus")`;
  }
  if (s === "success") {
    return Prisma.sql`wd.status = 'completed'::"WithdrawalStatus"`;
  }
  if (s === "failed") {
    return Prisma.sql`wd.status = 'failed'::"WithdrawalStatus"`;
  }
  return Prisma.sql`TRUE`;
}

/**
 * @param {unknown} raw `ledger_kind` query value
 * @returns {"all" | "deposit" | "payout"}
 */
export function parseLedgerKindQuery(raw) {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (s === "deposit") return "deposit";
  if (s === "payout") return "payout";
  return "all";
}

/**
 * @param {unknown} v
 * @returns {"all" | "deposit" | "payout"}
 */
function normalizeLedgerKind(v) {
  const s = String(v ?? "all").trim().toLowerCase();
  if (s === "deposit") return "deposit";
  if (s === "payout") return "payout";
  return "all";
}

/**
 * Union id page for merchant ledger (deposits + payouts), newest first.
 *
 * @param {{
 *   merchantIds: number[],
 *   environment: import("@prisma/client").MerchantGatewayEnv,
 *   skip: number,
 *   take: number,
 *   chain: string,
 *   chainOk: boolean,
 *   token: string,
 *   statusUi: string,
 *   qUser: string,
 *   qTxRef: string,
 *   qAddr: string,
 *   ledgerKind?: unknown,
 * }} p
 * @returns {Promise<{ entry_kind: string, entry_id: number }[]>}
 */
export async function fetchMerchantLedgerUnionPage(prisma, p) {
  const mids = p.merchantIds.filter((n) => Number.isInteger(n) && n >= 1);
  if (mids.length === 0) return [];

  const depositOnly =
    Boolean(String(p.qUser ?? "").trim()) ||
    Boolean(String(p.qTxRef ?? "").trim()) ||
    Boolean(String(p.qAddr ?? "").trim());

  if (depositOnly) {
    return [];
  }

  const kind = normalizeLedgerKind(p.ledgerKind);
  const includeDeposit = kind !== "payout";
  const includePayout = kind !== "deposit";

  const chainSql =
    p.chainOk && p.chain
      ? Prisma.sql`AND t.chain = ${p.chain}::"Chain"`
      : Prisma.empty;
  const chainWdSql =
    p.chainOk && p.chain
      ? Prisma.sql`AND wd.chain = ${p.chain}::"Chain"`
      : Prisma.empty;

  const tok = String(p.token ?? "").trim();
  const tokenSql = tok
    ? Prisma.sql`AND LOWER(t.token_symbol) = LOWER(${tok})`
    : Prisma.empty;
  const tokenWdSql = tok
    ? Prisma.sql`AND LOWER(wd.token_symbol) = LOWER(${tok})`
    : Prisma.empty;

  const stSql = depositStatusSql(p.statusUi);
  const stWdSql = payoutStatusSql(p.statusUi);

  const depositRows = Prisma.sql`
    SELECT 'deposit'::text AS entry_kind, t.id AS entry_id, t.created_at AS sort_ts
    FROM transactions t
    INNER JOIN wallets w ON w.id = t.wallet_id AND w.deleted_at IS NULL
    WHERE t.deleted_at IS NULL
      AND w.merchant_id IN (${Prisma.join(mids)})
      AND w.environment = ${p.environment}::"MerchantGatewayEnv"
      AND ${stSql}
      ${chainSql}
      ${tokenSql}
  `;

  const payoutRows = Prisma.sql`
    SELECT 'payout'::text AS entry_kind, wd.id AS entry_id, wd.created_at AS sort_ts
    FROM withdrawals wd
    WHERE wd.deleted_at IS NULL
      AND wd.merchant_id IN (${Prisma.join(mids)})
      AND wd.environment = ${p.environment}::"MerchantGatewayEnv"
      AND ${stWdSql}
      ${chainWdSql}
      ${tokenWdSql}
  `;

  /** @type {import("@prisma/client").Prisma.Sql} */
  let unionInner;
  if (includeDeposit && includePayout) {
    unionInner = Prisma.sql`${depositRows} UNION ALL ${payoutRows}`;
  } else if (includeDeposit) {
    unionInner = depositRows;
  } else {
    unionInner = payoutRows;
  }

  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT entry_kind, entry_id FROM (
        ${unionInner}
      ) u
      ORDER BY u.sort_ts DESC
      LIMIT ${p.take} OFFSET ${p.skip}
    `,
  );
  return /** @type {{ entry_kind: string, entry_id: number }[]} */ (rows);
}

/**
 * @param {Parameters<typeof fetchMerchantLedgerUnionPage>[1]} p
 */
export async function countMerchantLedgerUnion(prisma, p) {
  const mids = p.merchantIds.filter((n) => Number.isInteger(n) && n >= 1);
  if (mids.length === 0) return 0;

  const depositOnly =
    Boolean(String(p.qUser ?? "").trim()) ||
    Boolean(String(p.qTxRef ?? "").trim()) ||
    Boolean(String(p.qAddr ?? "").trim());

  if (depositOnly) {
    return null;
  }

  const kind = normalizeLedgerKind(p.ledgerKind);
  const includeDeposit = kind !== "payout";
  const includePayout = kind !== "deposit";

  const chainSql =
    p.chainOk && p.chain
      ? Prisma.sql`AND t.chain = ${p.chain}::"Chain"`
      : Prisma.empty;
  const chainWdSql =
    p.chainOk && p.chain
      ? Prisma.sql`AND wd.chain = ${p.chain}::"Chain"`
      : Prisma.empty;

  const tok = String(p.token ?? "").trim();
  const tokenSql = tok
    ? Prisma.sql`AND LOWER(t.token_symbol) = LOWER(${tok})`
    : Prisma.empty;
  const tokenWdSql = tok
    ? Prisma.sql`AND LOWER(wd.token_symbol) = LOWER(${tok})`
    : Prisma.empty;

  const stSql = depositStatusSql(p.statusUi);
  const stWdSql = payoutStatusSql(p.statusUi);

  const depositCount = Prisma.sql`
    SELECT 1
    FROM transactions t
    INNER JOIN wallets w ON w.id = t.wallet_id AND w.deleted_at IS NULL
    WHERE t.deleted_at IS NULL
      AND w.merchant_id IN (${Prisma.join(mids)})
      AND w.environment = ${p.environment}::"MerchantGatewayEnv"
      AND ${stSql}
      ${chainSql}
      ${tokenSql}
  `;

  const payoutCount = Prisma.sql`
    SELECT 1
    FROM withdrawals wd
    WHERE wd.deleted_at IS NULL
      AND wd.merchant_id IN (${Prisma.join(mids)})
      AND wd.environment = ${p.environment}::"MerchantGatewayEnv"
      AND ${stWdSql}
      ${chainWdSql}
      ${tokenWdSql}
  `;

  /** @type {import("@prisma/client").Prisma.Sql} */
  let unionInner;
  if (includeDeposit && includePayout) {
    unionInner = Prisma.sql`${depositCount} UNION ALL ${payoutCount}`;
  } else if (includeDeposit) {
    unionInner = depositCount;
  } else {
    unionInner = payoutCount;
  }

  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT COUNT(*)::int AS c FROM (
        ${unionInner}
      ) x
    `,
  );
  const r = Array.isArray(rows) ? rows[0] : null;
  return r && typeof r.c === "number" ? r.c : 0;
}
