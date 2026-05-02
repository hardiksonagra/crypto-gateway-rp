import { Chain, Prisma, TxStatus } from "@prisma/client";
import { countDistinctWalletDepositIdentitiesInEnv } from "./admin-dashboard-env-identity-counts.js";
import { ACTIVE } from "./active-row.js";
import { lastNDatesInZone, sanitizeIanaTimeZone } from "./ianaTimeZone.js";
import { prismaClientKnowsTxStatusCreated } from "./prisma-tx-status.js";

const ADMIN_DASH_METRICS_PRESETS = new Set(["today", "7d", "30d", "all"]);
const ADMIN_DASH_METRICS_MAX_RANGE_DAYS = 731;

/**
 * @param {"today" | "7d" | "30d" | "all"} preset
 * @param {string} tzIana
 */
function adminDashboardTxMetricsLocalDateFilterSql(preset, tzIana) {
  const z = `'${String(tzIana).replace(/'/g, "''")}'`;
  const zlit = Prisma.raw(z);
  if (preset === "today") {
    return Prisma.sql`AND ((t.created_at AT TIME ZONE ${zlit}))::date = ((CURRENT_TIMESTAMP AT TIME ZONE ${zlit}))::date`;
  }
  if (preset === "7d") {
    return Prisma.sql`AND ((t.created_at AT TIME ZONE ${zlit}))::date >= ((CURRENT_TIMESTAMP AT TIME ZONE ${zlit}))::date - 6`;
  }
  if (preset === "30d") {
    return Prisma.sql`AND ((t.created_at AT TIME ZONE ${zlit}))::date >= ((CURRENT_TIMESTAMP AT TIME ZONE ${zlit}))::date - 29`;
  }
  return Prisma.sql``;
}

/**
 * @param {"today" | "7d" | "30d" | "all"} preset
 */
function adminDashboardMetricsRangeLabel(preset) {
  if (preset === "today") return "Today";
  if (preset === "7d") return "Last 7 days";
  if (preset === "30d") return "Last 30 days";
  return "All time";
}

/** @param {unknown} s */
function parseMetricsYmd(s) {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

/**
 * @param {string} a
 * @param {string} b
 */
function ymdInclusiveDaySpan(a, b) {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  const u1 = Date.UTC(y1, m1 - 1, d1);
  const u2 = Date.UTC(y2, m2 - 1, d2);
  return Math.floor((u2 - u1) / 86400000) + 1;
}

/**
 * @param {string} fromYmd
 * @param {string} toYmd
 * @param {string} tzIana
 */
function adminDashboardTxMetricsBetweenYmdSql(fromYmd, toYmd, tzIana) {
  const zlit = Prisma.raw(`'${String(tzIana).replace(/'/g, "''")}'`);
  const flit = Prisma.raw(`'${fromYmd}'`);
  const tlit = Prisma.raw(`'${toYmd}'`);
  return Prisma.sql`AND ((t.created_at AT TIME ZONE ${zlit}))::date >= ${flit}::date AND ((t.created_at AT TIME ZONE ${zlit}))::date <= ${tlit}::date`;
}

const CHAINS = new Set(Object.values(Chain));

/**
 * Dashboard payload matching GET /api/v1/admin/dashboard, scoped to RP merchants.
 *
 * @param {import("@prisma/client").PrismaClient} prisma
 * @param {{
 *   rpId: number;
 *   listEnv: import("@prisma/client").MerchantGatewayEnv;
 *   query: Record<string, string | undefined>;
 * }} opts
 */
export async function computeRpDashboardPayload(prisma, { rpId, listEnv, query }) {
  const mids = (
    await prisma.merchant.findMany({
      where: { resellerPartnerId: rpId, deletedAt: null },
      select: { id: true },
    })
  ).map((m) => m.id);

  const emptyDaily = (viewerTz) =>
    lastNDatesInZone(14, viewerTz).map((date) => ({
      date,
      pending: 0,
      success: 0,
      failed: 0,
      underpaid: 0,
    }));

  const viewerTz = sanitizeIanaTimeZone(query.tz) ?? "UTC";
  const tzSql = `'${viewerTz.replace(/'/g, "''")}'`;
  const dayKeys = lastNDatesInZone(14, viewerTz);
  const wideFrom = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);

  const presetRaw =
    typeof query.metrics_preset === "string" ? query.metrics_preset.trim().toLowerCase() : "";
  const metricsPreset = ADMIN_DASH_METRICS_PRESETS.has(presetRaw) ? presetRaw : "today";

  const metricsFromParsed = parseMetricsYmd(query.metrics_from);
  const metricsToParsed = parseMetricsYmd(query.metrics_to);
  const useMetricsBetween =
    metricsFromParsed != null &&
    metricsToParsed != null &&
    metricsFromParsed <= metricsToParsed &&
    ymdInclusiveDaySpan(metricsFromParsed, metricsToParsed) <= ADMIN_DASH_METRICS_MAX_RANGE_DAYS;

  if (mids.length === 0) {
    let metricsRangeLabel = "All time";
    if (metricsPreset !== "all") {
      metricsRangeLabel = useMetricsBetween
        ? metricsFromParsed === metricsToParsed
          ? metricsFromParsed
          : `${metricsFromParsed} → ${metricsToParsed}`
        : adminDashboardMetricsRangeLabel(metricsPreset);
    }
    return {
      viewer_environment: listEnv,
      metrics_preset: useMetricsBetween ? "custom" : metricsPreset,
      metrics_from: useMetricsBetween ? metricsFromParsed : null,
      metrics_to: useMetricsBetween ? metricsToParsed : null,
      metrics_range_label: metricsRangeLabel,
      merchants: 0,
      end_users: 0,
      transactions_total: 0,
      transactions_success: 0,
      transactions_failed_underpaid: 0,
      wallets_in_env: 0,
      transactions_by_status: [],
      transactions_by_chain: [],
      transactions_daily_by_status: emptyDaily(viewerTz),
    };
  }

  const midSql = Prisma.join(mids);

  const txEnvWhere = {
    wallet: {
      is: {
        environment: listEnv,
        deletedAt: null,
        merchantId: { in: mids },
      },
    },
  };

  const txEnvBase = { ...txEnvWhere, ...ACTIVE };

  const txMetricsPromise = (async () => {
    if (metricsPreset === "all") {
      const [total, ok, issues] = await Promise.all([
        prisma.transaction.count({ where: txEnvBase }),
        prisma.transaction.count({
          where: { ...txEnvBase, status: TxStatus.success },
        }),
        prisma.transaction.count({
          where: {
            ...txEnvBase,
            status: { in: [TxStatus.failed, TxStatus.underpaid] },
          },
        }),
      ]);
      return { total, ok, issues };
    }
    const df = useMetricsBetween
      ? adminDashboardTxMetricsBetweenYmdSql(
          metricsFromParsed,
          metricsToParsed,
          viewerTz,
        )
      : adminDashboardTxMetricsLocalDateFilterSql(metricsPreset, viewerTz);
    const rows = await prisma.$queryRaw(
      Prisma.sql`
        SELECT
          COUNT(*)::int AS c_total,
          COUNT(*) FILTER (WHERE t.status = 'success')::int AS c_success,
          COUNT(*) FILTER (WHERE t.status IN ('failed','underpaid'))::int AS c_issues
        FROM transactions t
        INNER JOIN wallets w ON w.id = t.wallet_id
        WHERE w.environment = ${listEnv}::"MerchantGatewayEnv"
          AND w.deleted_at IS NULL
          AND t.deleted_at IS NULL
          AND w.merchant_id IN (${midSql})
          ${df}
      `,
    );
    const r = rows[0];
    return {
      total: Number(r?.c_total ?? 0),
      ok: Number(r?.c_success ?? 0),
      issues: Number(r?.c_issues ?? 0),
    };
  })();

  const byStatusPromise = prismaClientKnowsTxStatusCreated()
    ? prisma.transaction.groupBy({
        by: ["status"],
        where: { ...txEnvWhere, deletedAt: null },
        _count: { _all: true },
      })
    : prisma
        .$queryRaw(
          Prisma.sql`
          SELECT t.status::text AS status, COUNT(*)::int AS cnt
          FROM transactions t
          INNER JOIN wallets w ON w.id = t.wallet_id
          WHERE w.environment = ${listEnv}::"MerchantGatewayEnv"
            AND w.deleted_at IS NULL
            AND t.deleted_at IS NULL
            AND w.merchant_id IN (${midSql})
          GROUP BY t.status
        `,
        )
        .then((rows) =>
          rows.map((r) => ({
            status: r.status,
            _count: { _all: Number(r.cnt) },
          })),
        );

  const merchantHasWalletInEnv = {
    pooledWallets: {
      some: { environment: listEnv, deletedAt: null },
    },
  };

  const [
    merchants,
    users,
    walletsInEnv,
    byStatus,
    byChain,
    dailyStatusRows,
    txMetrics,
  ] = await Promise.all([
    prisma.merchant.count({
      where: {
        id: { in: mids },
        deletedAt: null,
        isActive: true,
        ...merchantHasWalletInEnv,
      },
    }),
    prisma.user.count({
      where: {
        environment: listEnv,
        deletedAt: null,
        merchant: {
          id: { in: mids },
          deletedAt: null,
          isActive: true,
          ...merchantHasWalletInEnv,
        },
      },
    }),
    countDistinctWalletDepositIdentitiesInEnv(prisma, listEnv, mids),
    byStatusPromise,
    prisma.transaction.groupBy({
      by: ["chain"],
      where: { ...txEnvWhere, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.$queryRaw(
      Prisma.sql`
        SELECT ((t.created_at AT TIME ZONE ${Prisma.raw(tzSql)}))::date AS day,
               t.status::text AS status,
               COUNT(*)::int AS cnt
        FROM transactions t
        INNER JOIN wallets w ON w.id = t.wallet_id
        WHERE w.environment = ${listEnv}::"MerchantGatewayEnv"
          AND w.deleted_at IS NULL
          AND t.deleted_at IS NULL
          AND w.merchant_id IN (${midSql})
          AND t.created_at >= ${wideFrom}
        GROUP BY 1, 2
        ORDER BY 1, 2
      `,
    ),
    txMetricsPromise,
  ]);

  const txs = txMetrics.total;
  const successTxs = txMetrics.ok;
  const txsIssues = txMetrics.issues;

  let metricsRangeLabel;
  if (metricsPreset === "all") {
    metricsRangeLabel = "All time";
  } else if (useMetricsBetween) {
    metricsRangeLabel =
      metricsFromParsed === metricsToParsed
        ? metricsFromParsed
        : `${metricsFromParsed} → ${metricsToParsed}`;
  } else {
    metricsRangeLabel = adminDashboardMetricsRangeLabel(metricsPreset);
  }

  /** @type {Map<string, { pending: number, success: number, failed: number, underpaid: number }>} */
  const dailyMap = new Map();
  for (const row of dailyStatusRows) {
    const dayVal = row.day;
    const key =
      dayVal instanceof Date
        ? dayVal.toISOString().slice(0, 10)
        : String(dayVal).slice(0, 10);
    if (!dailyMap.has(key)) {
      dailyMap.set(key, { pending: 0, success: 0, failed: 0, underpaid: 0 });
    }
    const bucket = /** @type {{ pending: number, success: number, failed: number, underpaid: number }} */ (
      dailyMap.get(key)
    );
    const st = String(row.status);
    const c = Number(row.cnt);
    if (st === "pending" || st === "created") bucket.pending += c;
    else if (st === "success") bucket.success = c;
    else if (st === "failed") bucket.failed += c;
    else if (st === "underpaid") bucket.underpaid += c;
  }

  const transactions_daily_by_status = dayKeys.map((date) => {
    const b = dailyMap.get(date) ?? {
      pending: 0,
      success: 0,
      failed: 0,
      underpaid: 0,
    };
    return {
      date,
      pending: b.pending,
      success: b.success,
      failed: b.failed,
      underpaid: b.underpaid,
    };
  });

  return {
    viewer_environment: listEnv,
    metrics_preset: useMetricsBetween ? "custom" : metricsPreset,
    metrics_from: useMetricsBetween ? metricsFromParsed : null,
    metrics_to: useMetricsBetween ? metricsToParsed : null,
    metrics_range_label: metricsRangeLabel,
    merchants,
    end_users: users,
    transactions_total: txs,
    transactions_success: successTxs,
    transactions_failed_underpaid: txsIssues,
    wallets_in_env: walletsInEnv,
    transactions_by_status: byStatus.map((r) => ({
      status: r.status,
      count: r._count._all,
    })),
    transactions_by_chain: byChain
      .filter((r) => CHAINS.has(r.chain))
      .map((r) => ({
        chain: r.chain,
        count: r._count._all,
      }))
      .sort((a, b) => b.count - a.count),
    transactions_daily_by_status,
  };
}
