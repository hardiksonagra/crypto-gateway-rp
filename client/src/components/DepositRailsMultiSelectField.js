import { Field, useFormikContext } from "formik";
import { depositRailsForChains } from "../admin/depositRailOptions.js";

/**
 * Multi-select deposit rails (`supported_deposit_rails`), filtered by `default_chains`.
 *
 * @param {object} props
 * @param {string} props.name
 * @param {string} [props.chainsFieldName]
 * @param {string[]} [props.platformEnabledChains] Intersect rails with platform-enabled chains only.
 * @param {boolean} [props.useFullProductCatalog] Admin merchant forms: full rail list even when VITE narrows the merchant portal.
 */
export default function DepositRailsMultiSelectField({
  name,
  chainsFieldName = "default_chains",
  platformEnabledChains,
  useFullProductCatalog = false,
}) {
  const { values } = useFormikContext();
  const chains = Array.isArray(values[chainsFieldName])
    ? values[chainsFieldName]
    : [];
  const options = depositRailsForChains(chains, platformEnabledChains, useFullProductCatalog);

  return (
    <Field name={name}>
      {({ field, form, meta }) => {
        const selected = Array.isArray(field.value) ? field.value : [];
        return (
          <div>
            {options.length === 0 ? (
              <p className="text-xs text-amber-200/80">
                Select at least one chain to choose currency / network pairs.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {options.map((o) => {
                  const isOn = selected.includes(o.key);
                  return (
                    <label
                      key={o.key}
                      className={`cursor-pointer select-none rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                        isOn
                          ? "border-white/35 bg-white/10 text-white"
                          : "border-white/15 text-white/55 hover:border-white/25 hover:text-white/75"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={isOn}
                        onChange={() => {
                          const cur = Array.isArray(field.value)
                            ? [...field.value]
                            : [];
                          const next = isOn
                            ? cur.filter((x) => x !== o.key)
                            : [...cur, o.key];
                          void form.setFieldValue(name, next);
                        }}
                      />
                      {o.label}
                    </label>
                  );
                })}
              </div>
            )}
            {meta.touched && typeof meta.error === "string" ? (
              <p className="mt-1 text-xs text-rose-400">{meta.error}</p>
            ) : null}
          </div>
        );
      }}
    </Field>
  );
}
