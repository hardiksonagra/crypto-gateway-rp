import { Formik, Form, Field, ErrorMessage } from "formik";
import * as yup from "yup";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getToken, setImpersonationAdminToken, setToken } from "../../api";
import ConfirmModal from "../../components/ConfirmModal";
import { BrandLoader } from "../../components/BrandLoader.js";

const input =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-white/20 focus:ring-1";
const label = "mb-1 block text-xs font-medium text-white/60";

const createSchema = yup.object({
  email: yup.string().trim().email().required(),
  password: yup.string().trim().min(8).required(),
  display_name: yup.string().trim().optional(),
  mdr_percent: yup
    .number()
    .typeError("MDR must be a number")
    .min(0, "Min 0")
    .max(100, "Max 100")
    .required(),
  payout_mdr_percent: yup
    .number()
    .typeError("Payout MDR must be a number")
    .min(0, "Min 0")
    .max(100, "Max 100")
    .required(),
});

const editSchema = yup.object({
  display_name: yup.string().trim().optional(),
  password: yup.string().trim().optional().test("len", "Min 8 chars", (v) => !v || v.length >= 8),
  is_active: yup.boolean().required(),
  mdr_percent: yup
    .number()
    .typeError("MDR must be a number")
    .min(0, "Min 0")
    .max(100, "Max 100")
    .required(),
  payout_mdr_percent: yup
    .number()
    .typeError("Payout MDR must be a number")
    .min(0, "Min 0")
    .max(100, "Max 100")
    .required(),
});

export default function ResellerPartners() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [editId, setEditId] = useState(null);
  const [deactivateId, setDeactivateId] = useState(null);
  const [impersonatingId, setImpersonatingId] = useState(null);
  const [impersonateError, setImpersonateError] = useState("");

  const listQ = useQuery({
    queryKey: ["admin-reseller-partners"],
    queryFn: () => api("/api/v1/admin/reseller-partners"),
  });

  const createM = useMutation({
    mutationFn: (json) => api("/api/v1/admin/reseller-partners", { method: "POST", json }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-reseller-partners"] });
    },
  });

  const patchM = useMutation({
    mutationFn: ({ id, json }) =>
      api(`/api/v1/admin/reseller-partners/${id}`, { method: "PATCH", json }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-reseller-partners"] });
      setEditId(null);
    },
  });

  const deactivateM = useMutation({
    mutationFn: (id) =>
      api(`/api/v1/admin/reseller-partners/${id}`, {
        method: "PATCH",
        json: { soft_delete: true },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-reseller-partners"] });
      setDeactivateId(null);
    },
  });

  const rows = listQ.data?.reseller_partners ?? [];
  const editing = rows.find((r) => r.id === editId);

  async function loginAsRp(id) {
    setImpersonateError("");
    setImpersonatingId(id);
    try {
      const adminTok = getToken();
      if (!adminTok) throw new Error("Not signed in");
      const r = await api(`/api/v1/admin/reseller-partners/${id}/impersonate`, { method: "POST" });
      setImpersonationAdminToken(adminTok);
      setToken(r.token);
      nav("/rp", { replace: true });
    } catch (e) {
      setImpersonateError(String(e));
    } finally {
      setImpersonatingId(null);
    }
  }

  return (
    <div className="w-full max-w-none">
      <h1 className="font-display text-2xl font-semibold text-white">Reseller partners (RP)</h1>

      <div className="glass mt-8 w-full rounded-2xl p-6 lg:col-span-2 lg:p-8">
        <h2 className="text-sm font-semibold text-white/80">Create RP</h2>
        <Formik
          initialValues={{ email: "", password: "", display_name: "", mdr_percent: 0, payout_mdr_percent: 0 }}
          validationSchema={createSchema}
          validateOnBlur
          validateOnChange={false}
          onSubmit={async (values, { resetForm, setStatus }) => {
            setStatus(undefined);
            try {
              await createM.mutateAsync({
                email: values.email.trim().toLowerCase(),
                password: values.password,
                display_name: values.display_name?.trim() || undefined,
                mdr_percent: Number(values.mdr_percent),
                payout_mdr_percent: Number(values.payout_mdr_percent),
              });
              resetForm();
            } catch (e) {
              setStatus(String(e));
            }
          }}
        >
          {({ isSubmitting, status }) => (
            <Form className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <label className={label} htmlFor="rp-email">Email</label>
                <Field id="rp-email" name="email" type="email" className={input} autoComplete="off" />
                <ErrorMessage name="email" component="p" className="mt-1 text-xs text-rose-400" />
              </div>
              <div>
                <label className={label} htmlFor="rp-pass">Password</label>
                <Field id="rp-pass" name="password" type="password" className={input} autoComplete="new-password" />
                <ErrorMessage name="password" component="p" className="mt-1 text-xs text-rose-400" />
              </div>
              <div className="lg:col-span-2">
                <label className={label} htmlFor="rp-dn">Display name</label>
                <Field id="rp-dn" name="display_name" type="text" className={input} />
              </div>
              <div>
                <label className={label} htmlFor="rp-mdr">Default deposit MDR %</label>
                <Field
                  id="rp-mdr"
                  name="mdr_percent"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  className={input}
                />
                <ErrorMessage name="mdr_percent" component="p" className="mt-1 text-xs text-rose-400" />
                <p className="mt-1 text-[10px] text-white/40">Default deposit (transaction) MDR when they create merchants.</p>
              </div>
              <div>
                <label className={label} htmlFor="rp-payout-mdr">Default payout MDR %</label>
                <Field
                  id="rp-payout-mdr"
                  name="payout_mdr_percent"
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  className={input}
                />
                <ErrorMessage name="payout_mdr_percent" component="p" className="mt-1 text-xs text-rose-400" />
                <p className="mt-1 text-[10px] text-white/40">
                  Default reference % on payout volume for merchants they create (previews and ledger rows; on-chain sends
                  remain full gross).
                </p>
              </div>
              {status ? <p className="lg:col-span-2 text-sm text-rose-400">{status}</p> : null}
              <div className="lg:col-span-2">
                <button type="submit" disabled={isSubmitting || createM.isPending} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
                  {createM.isPending ? "Creating…" : "Create RP"}
                </button>
              </div>
            </Form>
          )}
        </Formik>
      </div>

      <div className="mt-10">
        <h2 className="text-sm font-semibold tracking-wide text-white/40 uppercase">All partners</h2>
        {impersonateError ? (
          <p className="mt-3 text-sm text-rose-400">{impersonateError}</p>
        ) : null}
        {listQ.isLoading ? (
          <BrandLoader variant="section" className="mt-6" title="" subtitle="Loading…" />
        ) : (
          <div className="data-table-surface mt-4 overflow-x-auto">
            <table className="data-table min-w-[880px]">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Email</th>
                  <th>Display</th>
                  <th>Deposit MDR %</th>
                  <th>Payout MDR %</th>
                  <th>Merchants</th>
                  <th>Active</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="!py-10 text-center text-sm text-white/45">
                      No reseller partners yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td className="font-mono text-xs">{r.id}</td>
                      <td className="text-xs">{r.email}</td>
                      <td className="text-xs text-white/70">{r.display_name ?? "—"}</td>
                      <td className="font-mono text-xs text-white/80">{Number(r.mdr_percent ?? 0)}</td>
                      <td className="font-mono text-xs text-white/80">{Number(r.payout_mdr_percent ?? r.mdr_percent ?? 0)}</td>
                      <td className="font-mono text-xs">{r.merchant_count ?? 0}</td>
                      <td className="text-xs">{r.is_active ? "Yes" : "No"}</td>
                      <td className="text-right whitespace-nowrap">
                        <button
                          type="button"
                          disabled={!r.is_active || impersonatingId === r.id}
                          onClick={() => void loginAsRp(r.id)}
                          className="text-xs text-emerald-300/90 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {impersonatingId === r.id ? "Opening…" : "Log in as RP"}
                        </button>
                        {" · "}
                        <button
                          type="button"
                          onClick={() => setEditId(r.id)}
                          className="text-xs text-sky-300 hover:text-sky-200"
                        >
                          Edit
                        </button>
                        {" · "}
                        <button
                          type="button"
                          onClick={() => setDeactivateId(r.id)}
                          className="text-xs text-rose-300/90 hover:text-rose-200"
                        >
                          Deactivate
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog">
          <div className="glass max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl p-6">
            <h3 className="font-display text-lg font-semibold text-white">Edit RP #{editing.id}</h3>
            <Formik
              key={editing.id}
              initialValues={{
                display_name: editing.display_name ?? "",
                password: "",
                is_active: editing.is_active,
                mdr_percent: Number(editing.mdr_percent ?? 0),
                payout_mdr_percent: Number(editing.payout_mdr_percent ?? editing.mdr_percent ?? 0),
              }}
              validationSchema={editSchema}
              onSubmit={async (values, { setStatus }) => {
                setStatus(undefined);
                try {
                  const json = {
                    display_name: values.display_name?.trim() || null,
                    is_active: values.is_active,
                    mdr_percent: Number(values.mdr_percent),
                    payout_mdr_percent: Number(values.payout_mdr_percent),
                  };
                  if (values.password?.trim()) {
                    json.password = values.password.trim();
                  }
                  await patchM.mutateAsync({ id: editing.id, json });
                } catch (e) {
                  setStatus(String(e));
                }
              }}
            >
              {({ isSubmitting, status }) => (
                <Form className="mt-4 space-y-4">
                  <div>
                    <label className={label}>Display name</label>
                    <Field name="display_name" type="text" className={input} />
                  </div>
                  <div>
                    <label className={label}>New password (optional)</label>
                    <Field name="password" type="password" className={input} autoComplete="new-password" />
                    <ErrorMessage name="password" component="p" className="mt-1 text-xs text-rose-400" />
                  </div>
                  <div>
                    <label className={label}>Default deposit MDR %</label>
                    <Field
                      name="mdr_percent"
                      type="number"
                      step="0.01"
                      min={0}
                      max={100}
                      className={input}
                    />
                    <ErrorMessage name="mdr_percent" component="p" className="mt-1 text-xs text-rose-400" />
                    <p className="mt-1 text-[10px] text-white/40">
                      Default deposit MDR for new merchants; does not retro-change existing merchants.
                    </p>
                  </div>
                  <div>
                    <label className={label}>Default payout MDR %</label>
                    <Field
                      name="payout_mdr_percent"
                      type="number"
                      step="0.01"
                      min={0}
                      max={100}
                      className={input}
                    />
                    <ErrorMessage name="payout_mdr_percent" component="p" className="mt-1 text-xs text-rose-400" />
                    <p className="mt-1 text-[10px] text-white/40">
                      Default payout reference % for new merchants (preview / reporting; full gross sent on-chain).
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-white/80">
                    <Field type="checkbox" name="is_active" className="rounded border-white/20" />
                    Active
                  </label>
                  {status ? <p className="text-sm text-rose-400">{status}</p> : null}
                  <div className="flex gap-3 pt-2">
                    <button type="submit" disabled={isSubmitting || patchM.isPending} className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15">
                      Save
                    </button>
                    <button type="button" onClick={() => setEditId(null)} className="text-sm text-white/50 hover:text-white">
                      Cancel
                    </button>
                  </div>
                </Form>
              )}
            </Formik>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={deactivateId != null}
        title="Deactivate reseller partner?"
        confirmLabel="Deactivate"
        onCancel={() => setDeactivateId(null)}
        onConfirm={() => {
          if (deactivateId != null) void deactivateM.mutateAsync(deactivateId);
        }}
        danger
        isLoading={deactivateM.isPending}
      >
        <p className="text-sm text-white/70">
          They will no longer be able to sign in at /rp. Linked merchants remain; you may need a DB restore to undo.
        </p>
      </ConfirmModal>
    </div>
  );
}
