import * as Yup from "yup";

export const depositExplorerKeyCreateSchema = Yup.object({
  name: Yup.string().trim().min(1).max(160).required(),
  api_key: Yup.string().trim().min(1).required(),
  max_requests_per_day: Yup.number()
    .integer()
    .min(1)
    .max(10_000_000)
    .required(),
  max_requests_per_second: Yup.number().integer().min(1).max(500).required(),
  sort_order: Yup.number().integer().min(-99999).max(99999).default(0),
});

export const depositExplorerKeyEditSchema = Yup.object({
  name: Yup.string().trim().min(1).max(160).required(),
  api_key: Yup.string().trim().max(2000).default(""),
  max_requests_per_day: Yup.number()
    .integer()
    .min(1)
    .max(10_000_000)
    .required(),
  max_requests_per_second: Yup.number().integer().min(1).max(500).required(),
  sort_order: Yup.number().integer().min(-99999).max(99999).required(),
  is_active: Yup.boolean().oneOf([true, false]).required(),
});
