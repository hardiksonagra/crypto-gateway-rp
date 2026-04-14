import { Field } from "formik";
import { MERCHANT_SETTINGS_CHAIN_VALUES } from "../admin/depositRailOptions.js";

/**
 * Multi-select chains as toggle chips (Formik field must be an array of chain codes).
 *
 * @param {object} props
 * @param {string} props.name
 * @param {string} [props.description]
 * @param {string[]} [props.allowedChainValues] When set, only these chips (platform-enabled subset).
 */
export default function ChainMultiSelectField({ name, description, allowedChainValues }) {
  const options =
    Array.isArray(allowedChainValues) && allowedChainValues.length > 0
      ? allowedChainValues
      : MERCHANT_SETTINGS_CHAIN_VALUES;

  return (
    <Field name={name}>
      {({ field, form, meta }) => (
        <div>
          {description ? <p className="mb-2 text-xs text-white/45">{description}</p> : null}
          {options.length === 0 ? (
            <p className="text-xs text-amber-200/80">
              No chains are enabled for merchants. An operator must turn on at least one chain in Admin → Supported
              chains.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {options.map((c) => {
              const selected = Array.isArray(field.value) && field.value.includes(c);
              return (
                <label
                  key={c}
                  className={`cursor-pointer select-none rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                    selected
                      ? "border-white/35 bg-white/10 text-white"
                      : "border-white/15 text-white/55 hover:border-white/25 hover:text-white/75"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={selected}
                    onChange={() => {
                      const cur = Array.isArray(field.value) ? [...field.value] : [];
                      const next = selected ? cur.filter((x) => x !== c) : [...cur, c];
                      void form.setFieldValue(name, next);
                    }}
                  />
                  {c}
                </label>
              );
            })}
          </div>
          {meta.touched && typeof meta.error === "string" ? (
            <p className="mt-1 text-xs text-rose-400">{meta.error}</p>
          ) : null}
        </div>
      )}
    </Field>
  );
}
