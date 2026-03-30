import * as Yup from "yup";

/**
 * @param {string[]} keys
 */
export function buildSystemSettingsSchema(keys) {
  const shape = Object.fromEntries(keys.map((k) => [k, Yup.string()]));
  return Yup.object(shape);
}
