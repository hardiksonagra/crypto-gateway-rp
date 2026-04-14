import { Formik, Form, Field, ErrorMessage } from "formik";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { buildSystemSettingsSchema } from "../../admin/systemSettingsSchemas";
import { BrandLoader } from "../../components/BrandLoader.js";

const input =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-white/20 focus:ring-1";
const label = "mb-1 block text-xs font-medium text-white/60";
const textarea = `${input} min-h-[120px] font-mono text-xs leading-relaxed`;

/**
 * @typedef {{
 *   key: string,
 *   label: string,
 *   category: string,
 *   type: string, // includes "usdt6" for USDT decimal admin fields
 *   sensitive: boolean,
 *   has_db_override: boolean,
 *   env_display: string,
 *   effective_display: string,
 *   form_initial: string,
 * }} SettingItem
 */

function FieldForItem({ it }) {
  const name = it.key;
  if (it.type === "bool" || it.type === "bool_tron_gateway") {
    return (
      <div className="lg:col-span-1">
        <label className={label} htmlFor={name}>
          {it.label}
        </label>
        <Field id={name} name={name} as="select" className={input}>
          <option value="">Use .env default ({it.env_display || "—"})</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </Field>
        <ErrorMessage
          name={name}
          component="p"
          className="mt-1 text-xs text-rose-400"
        />
        {it.has_db_override ? (
          <p className="mt-1 text-[11px] text-amber-200/80">
            Database override active — choose “Use .env default” and save to
            clear it.
          </p>
        ) : null}
      </div>
    );
  }

  if (it.type === "usdt6") {
    return (
      <div className="lg:col-span-1">
        <label className={label} htmlFor={name}>
          {it.label}
        </label>
        <Field
          id={name}
          name={name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="1"
          className={input}
        />
        <p className="mt-1 text-[11px] text-white/45">
          USDT amount (example:{" "}
          <span className="font-mono text-white/70">1</span> = 1 USDT). Server
          stores 6-decimal atomic units;{" "}
          <span className="font-mono text-white/70">.env</span> default shown as
          USDT below.
        </p>
        <p className="mt-0.5 text-[11px] text-white/35">
          Effective now:{" "}
          <span className="font-mono text-emerald-200/90">
            {it.effective_display || "—"} USDT
          </span>
          {" · "}
          .env:{" "}
          <span className="font-mono text-white/55">
            {it.env_display || "—"} USDT
          </span>
        </p>
        <ErrorMessage
          name={name}
          component="p"
          className="mt-1 text-xs text-rose-400"
        />
      </div>
    );
  }

  if (it.type === "json") {
    return (
      <div className="lg:col-span-2">
        <label className={label} htmlFor={name}>
          {it.label}
        </label>
        <Field
          id={name}
          name={name}
          as="textarea"
          className={textarea}
          spellCheck={false}
        />
        <p className="mt-1 text-[11px] text-white/40">
          Must be a JSON object. Clear the field and save to fall back to .env.
        </p>
        <ErrorMessage
          name={name}
          component="p"
          className="mt-1 text-xs text-rose-400"
        />
      </div>
    );
  }

  const isSecret = it.sensitive;
  return (
    <div
      className={
        it.type === "comma_origins" ? "lg:col-span-2" : "lg:col-span-1"
      }
    >
      <label className={label} htmlFor={name}>
        {it.label}
      </label>
      <Field
        id={name}
        name={name}
        type="text"
        className={isSecret ? `${input} font-mono text-xs` : input}
        autoComplete="off"
        spellCheck={false}
        placeholder={
          isSecret
            ? it.has_db_override
              ? "Edit or clear to remove DB override (.env)"
              : "Set to store in DB (overrides .env)"
            : undefined
        }
      />
      {isSecret ? (
        <p className="mt-1 text-[11px] text-white/40">
          {it.has_db_override ? (
            <>
              Value is stored in the database (shown in the field). Clear the
              field and save to remove it and use{" "}
              <span className="font-mono text-white/55">.env</span> instead.
            </>
          ) : (
            <>
              <span className="font-mono text-white/55">.env</span> may define
              this key ({it.effective_display}
              ); it is not loaded into the form. Enter a value and save to store
              an override in the database.
            </>
          )}
        </p>
      ) : null}
      <ErrorMessage
        name={name}
        component="p"
        className="mt-1 text-xs text-rose-400"
      />
    </div>
  );
}

export default function SystemSettings() {
  const [items, setItems] = useState(
    /** @type {SettingItem[] | null} */ (null),
  );
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await api("/api/v1/admin/system-settings");
      setItems(r.items ?? []);
    } catch (e) {
      setLoadError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const initialValues = useMemo(() => {
    if (!items) return {};
    return Object.fromEntries(items.map((i) => [i.key, i.form_initial ?? ""]));
  }, [items]);

  const validationSchema = useMemo(() => {
    if (!items?.length) return buildSystemSettingsSchema([]);
    return buildSystemSettingsSchema(items);
  }, [items]);

  const byCategory = useMemo(() => {
    if (!items) return new Map();
    const m = new Map();
    for (const it of items) {
      if (!m.has(it.category)) m.set(it.category, []);
      m.get(it.category).push(it);
    }
    return m;
  }, [items]);

  if (loadError) {
    return (
      <div className="w-full max-w-none">
        <h1
          className="font-display text-2xl font-bold"
          style={{ color: "var(--text-1)" }}
        >
          System settings
        </h1>
        <p className="mt-4 text-sm text-rose-400">{loadError}</p>
      </div>
    );
  }

  if (!items) {
    return (
      <div className="w-full max-w-none">
        <h1
          className="font-display text-2xl font-bold"
          style={{ color: "var(--text-1)" }}
        >
          System settings
        </h1>
        <BrandLoader
          variant="section"
          title=""
          subtitle="Loading settings…"
          className="mt-4"
          aria-label="Loading system settings"
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-none">
      <h1
        className="font-display text-2xl font-bold"
        style={{ color: "var(--text-1)" }}
      >
        System settings
      </h1>
      <p className="mt-1 text-sm" style={{ color: "var(--text-2)" }}>
        Configure gateway behavior. Database overrides take effect immediately
        without restart.
      </p>
      <p className="mt-2 max-w-3xl text-sm text-white/55 text-pretty">
        Saving writes every field below to the database (even when a value
        matches <span className="font-mono text-white/80">.env</span>).
        Bootstrap secrets (database URL, mnemonic, JWT secret, encryption key,
        TRX funder private key) stay in{" "}
        <span className="font-mono text-white/80">.env</span> only. The running
        API reloads overrides on save;         restart PM2{" "}
        <span className="font-mono text-white/80">
          crypto-gateway-worker-erc20
        </span>{" "}
        /{" "}
        <span className="font-mono text-white/80">
          crypto-gateway-worker-trc20
        </span> /{" "}
        <span className="font-mono text-white/80">
          crypto-gateway-cron-maintenance
        </span>{" "}
        /{" "}
        <span className="font-mono text-white/80">
          crypto-gateway-cron-deposit-full-scan
        </span>{" "}
        /{" "}
        <span className="font-mono text-white/80">
          crypto-gateway-cron-tron-sweep
        </span>{" "}
        if you change ERC20/TRC20 scanner poll intervals or other cron-only behavior.
      </p>

      <div className="glass mt-8 w-full rounded-2xl p-6 lg:p-8">
        <Formik
          enableReinitialize
          initialValues={initialValues}
          validationSchema={validationSchema}
          validateOnBlur
          validateOnChange={false}
          onSubmit={async (values, { setStatus, setSubmitting }) => {
            setStatus(undefined);
            try {
              /** Full payload: one entry per registered key so the server updates every field on save. */
              const payload = Object.fromEntries(
                items.map((i) => [i.key, values[i.key] ?? ""]),
              );
              const r = await api("/api/v1/admin/system-settings", {
                method: "PUT",
                json: payload,
              });
              setItems(r.items ?? items);
            } catch (e) {
              setStatus(String(e));
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {({ isSubmitting, status }) => (
            <Form className="space-y-10">
              {[...byCategory.entries()].map(([category, list]) => (
                <section key={category}>
                  <h2 className="mb-4 border-b border-white/10 pb-2 font-display text-sm font-semibold tracking-wide text-white/80 uppercase">
                    {category}
                  </h2>
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    {list.map((it) => (
                      <FieldForItem key={it.key} it={it} />
                    ))}
                  </div>
                </section>
              ))}

              {status ? (
                <p className="lg:col-span-2 text-sm text-rose-400" role="alert">
                  {status}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-lg bg-white/90 px-4 py-2 text-sm font-medium text-black hover:bg-white disabled:opacity-50"
                >
                  {isSubmitting ? "Saving…" : "Save settings"}
                </button>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/5"
                >
                  Reload
                </button>
              </div>
            </Form>
          )}
        </Formik>
      </div>
    </div>
  );
}
