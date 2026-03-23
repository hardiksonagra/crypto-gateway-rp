import * as yup from "yup";

const newPasswordField = yup
  .string()
  .min(8, "Password must be at least 8 characters")
  .required("New password is required");

export const changePasswordSchema = yup.object({
  current_password: yup.string().required("Current password is required"),
  new_password: newPasswordField,
  new_password_confirm: yup
    .string()
    .oneOf([yup.ref("new_password")], "Passwords must match")
    .required("Confirm your new password"),
});

export const forgotPasswordSchema = yup.object({
  email: yup
    .string()
    .trim()
    .required("Email is required")
    .email("Invalid email"),
});

export const resetPasswordSchema = yup.object({
  new_password: newPasswordField,
  new_password_confirm: yup
    .string()
    .oneOf([yup.ref("new_password")], "Passwords must match")
    .required("Confirm your new password"),
});
