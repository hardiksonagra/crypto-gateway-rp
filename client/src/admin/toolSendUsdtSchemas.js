import * as yup from "yup";

export const toolSendUsdtSchema = yup.object({
  from_address: yup.string().trim().required("From address is required"),
  to_address: yup.string().trim().required("To address is required"),
});

export const toolSendUsdtInitialValues = {
  from_address: "",
  to_address: "",
};
