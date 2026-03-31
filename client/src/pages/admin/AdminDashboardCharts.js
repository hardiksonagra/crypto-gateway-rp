import { useMemo } from "react";
import HighchartsReact from "highcharts-react-official";

// Use the same ESM core as the module imports below — `highcharts` (package main) and `highcharts/esm/highcharts.js` are separate instances, which breaks solidgauge (#17).
import Highcharts from "highcharts/esm/highcharts.js";
import "highcharts/esm/highcharts-more.js";
import "highcharts/esm/modules/solid-gauge.js";

/**
 * @param {boolean} isDark
 * @returns {{ text: string, muted: string, grid: string, label: string }}
 */
function chartPalette(isDark) {
  return {
    text: isDark ? "#e2e8f0" : "#0f172a",
    muted: isDark ? "#94a3b8" : "#64748b",
    grid: isDark ? "rgba(148,163,184,0.14)" : "rgba(15,23,42,0.08)",
    label: isDark ? "#cbd5e1" : "#334155",
  };
}

/**
 * @param {object} props
 * @param {Array<{ date: string, pending: number, success: number, failed: number }>} props.daily
 * @param {Array<{ status: string, count: number }>} props.byStatus
 * @param {Array<{ chain: string, count: number }>} props.byChain
 * @param {number} props.successRatePct
 * @param {boolean} props.isDark
 */
export default function AdminDashboardCharts({
  daily,
  byStatus,
  byChain,
  successRatePct,
  isDark,
}) {
  const p = useMemo(() => chartPalette(isDark), [isDark]);

  const stackedOptions = useMemo(() => {
    const categories = daily.map((d) => {
      const [y, m, day] = d.date.split("-");
      return `${m}/${day}`;
    });
    return {
      chart: {
        type: "column",
        backgroundColor: "transparent",
        style: { fontFamily: "inherit" },
        height: 320,
      },
      credits: { enabled: false },
      title: {
        text: "Daily transactions",
        align: "left",
        style: { color: p.text, fontSize: "15px", fontWeight: "700" },
      },
      subtitle: {
        text: "Stacked by status — last 14 days",
        align: "left",
        style: { color: p.muted, fontSize: "11px" },
      },
      xAxis: {
        categories,
        lineColor: p.grid,
        tickColor: p.grid,
        labels: { style: { color: p.label, fontSize: "10px" } },
      },
      yAxis: {
        min: 0,
        title: { text: null },
        gridLineColor: p.grid,
        labels: { style: { color: p.label } },
      },
      legend: {
        align: "center",
        itemStyle: { color: p.label, fontWeight: "500" },
        itemHoverStyle: { color: p.text },
      },
      tooltip: {
        shared: true,
        backgroundColor: isDark ? "rgba(15,23,42,0.95)" : "rgba(255,255,255,0.98)",
        borderColor: p.grid,
        style: { color: p.text },
      },
      plotOptions: {
        column: {
          stacking: "normal",
          borderRadius: 3,
          borderWidth: 0,
        },
      },
      series: [
        {
          name: "Pending",
          data: daily.map((d) => d.pending),
          color: "rgba(251,191,36,0.92)",
        },
        {
          name: "Success",
          data: daily.map((d) => d.success),
          color: "rgba(52,211,153,0.92)",
        },
        {
          name: "Failed",
          data: daily.map((d) => d.failed),
          color: "rgba(248,113,113,0.92)",
        },
      ],
    };
  }, [daily, isDark, p]);

  const donutOptions = useMemo(() => {
    const order = ["success", "pending", "failed"];
    const colors = {
      success: "rgba(52,211,153,0.9)",
      pending: "rgba(251,191,36,0.9)",
      failed: "rgba(248,113,113,0.9)",
    };
    const map = Object.fromEntries(byStatus.map((x) => [x.status, x.count]));
    const data = order
      .filter((s) => (map[s] ?? 0) > 0)
      .map((s) => ({ name: s.charAt(0).toUpperCase() + s.slice(1), y: map[s] ?? 0, color: colors[s] }));
    if (data.length === 0) {
      data.push({ name: "No data", y: 1, color: "rgba(148,163,184,0.35)" });
    }
    return {
      chart: {
        type: "pie",
        backgroundColor: "transparent",
        height: 300,
      },
      credits: { enabled: false },
      title: {
        text: "Status mix",
        align: "left",
        style: { color: p.text, fontSize: "15px", fontWeight: "700" },
      },
      subtitle: {
        text: "All transactions in this environment",
        align: "left",
        style: { color: p.muted, fontSize: "11px" },
      },
      tooltip: {
        pointFormat: "<b>{point.percentage:.1f}%</b> ({point.y} tx)",
        backgroundColor: isDark ? "rgba(15,23,42,0.95)" : "rgba(255,255,255,0.98)",
        borderColor: p.grid,
        style: { color: p.text },
      },
      plotOptions: {
        pie: {
          innerSize: "58%",
          dataLabels: {
            enabled: true,
            distance: 18,
            format: "{point.name}: {point.y}",
            style: { color: p.label, fontSize: "10px", textOutline: "none" },
          },
        },
      },
      series: [{ name: "Transactions", data }],
    };
  }, [byStatus, isDark, p]);

  const barOptions = useMemo(() => {
    const rows = byChain.length ? byChain : [{ chain: "—", count: 0 }];
    return {
      chart: {
        type: "bar",
        backgroundColor: "transparent",
        height: Math.max(220, 48 + rows.length * 36),
      },
      credits: { enabled: false },
      title: {
        text: "Transactions by chain",
        align: "left",
        style: { color: p.text, fontSize: "15px", fontWeight: "700" },
      },
      subtitle: {
        text: "Where deposits were recorded",
        align: "left",
        style: { color: p.muted, fontSize: "11px" },
      },
      xAxis: {
        categories: rows.map((r) => r.chain),
        title: { text: null },
        lineWidth: 0,
        labels: { style: { color: p.label, fontWeight: "600" } },
      },
      yAxis: {
        min: 0,
        title: { text: null },
        gridLineColor: p.grid,
        labels: { style: { color: p.label } },
      },
      legend: { enabled: false },
      tooltip: {
        valueSuffix: " tx",
        backgroundColor: isDark ? "rgba(15,23,42,0.95)" : "rgba(255,255,255,0.98)",
        borderColor: p.grid,
        style: { color: p.text },
      },
      plotOptions: {
        bar: {
          borderRadius: 4,
          borderWidth: 0,
          colorByPoint: true,
          colors: [
            "rgba(56,189,248,0.85)",
            "rgba(139,92,246,0.85)",
            "rgba(52,211,153,0.85)",
            "rgba(251,191,36,0.85)",
            "rgba(248,113,113,0.85)",
            "rgba(244,114,182,0.85)",
            "rgba(94,234,212,0.85)",
            "rgba(165,180,252,0.85)",
          ],
        },
      },
      series: [{ name: "Count", data: rows.map((r) => r.count) }],
    };
  }, [byChain, isDark, p]);

  const gaugeOptions = useMemo(() => {
    const y = Math.min(100, Math.max(0, Math.round(successRatePct)));
    return {
      chart: { type: "solidgauge", backgroundColor: "transparent", height: 280 },
      credits: { enabled: false },
      title: {
        text: "Success rate",
        align: "left",
        style: { color: p.text, fontSize: "15px", fontWeight: "700" },
      },
      subtitle: {
        text: "Successful ÷ total (this environment)",
        align: "left",
        style: { color: p.muted, fontSize: "11px" },
      },
      pane: {
        center: ["50%", "72%"],
        size: "118%",
        startAngle: -90,
        endAngle: 90,
        background: {
          backgroundColor: isDark ? "rgba(30,41,59,0.6)" : "rgba(226,232,240,0.9)",
          innerRadius: "62%",
          outerRadius: "100%",
          shape: "arc",
          borderWidth: 0,
        },
      },
      yAxis: {
        min: 0,
        max: 100,
        lineWidth: 0,
        tickWidth: 0,
        minorTickInterval: null,
        tickAmount: 2,
        labels: { y: 14, distance: -28, style: { color: p.muted, fontSize: "10px" } },
      },
      tooltip: { enabled: false },
      plotOptions: {
        solidgauge: {
          dataLabels: {
            y: -18,
            borderWidth: 0,
            format:
              '<div style="text-align:center"><span style="font-size:1.75rem;font-weight:800;color:' +
              p.text +
              '">{y}%</span><br/><span style="font-size:10px;color:' +
              p.muted +
              '">deposits</span></div>',
          },
          linecap: "round",
          rounded: true,
        },
      },
      series: [
        {
          name: "Success",
          data: [
            {
              color: "rgba(52,211,153,0.95)",
              radius: "100%",
              innerRadius: "62%",
              y,
            },
          ],
        },
      ],
    };
  }, [isDark, p, successRatePct]);

  const chartKey = isDark ? "dark" : "light";

  return (
    <div className="space-y-6">
      <div
        className="rounded-2xl border p-4 sm:p-5"
        style={{
          background: "var(--bg-surface)",
          borderColor: "var(--border)",
        }}
      >
        <HighchartsReact highcharts={Highcharts} options={stackedOptions} key={`stack-${chartKey}`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div
          className="rounded-2xl border p-4 sm:p-5"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border)",
          }}
        >
          <HighchartsReact highcharts={Highcharts} options={donutOptions} key={`donut-${chartKey}`} />
        </div>
        <div
          className="rounded-2xl border p-4 sm:p-5"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border)",
          }}
        >
          <HighchartsReact highcharts={Highcharts} options={gaugeOptions} key={`gauge-${chartKey}`} />
        </div>
      </div>
      <div
        className="rounded-2xl border p-4 sm:p-5"
        style={{
          background: "var(--bg-surface)",
          borderColor: "var(--border)",
        }}
      >
        <HighchartsReact highcharts={Highcharts} options={barOptions} key={`bar-${chartKey}`} />
      </div>
    </div>
  );
}
