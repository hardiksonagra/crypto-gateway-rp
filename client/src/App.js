import { Navigate, Route, Routes } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import Profile from "./pages/Profile";
import AdminShell from "./layouts/AdminShell";
import MerchantShell from "./layouts/MerchantShell";
import AdminDashboard from "./pages/admin/Dashboard";
import AdminMerchants from "./pages/admin/Merchants";
import MerchantCreate from "./pages/admin/MerchantCreate";
import MerchantEdit from "./pages/admin/MerchantEdit";
import MerchantDetail from "./pages/admin/MerchantDetail";
import AdminUsers from "./pages/admin/Users";
import AdminTransactions from "./pages/admin/Transactions";
import AdminWithdrawals from "./pages/admin/Withdrawals";
import AdminActivityLog from "./pages/admin/ActivityLog";
import AdminTronSweep from "./pages/admin/TronSweep";
import AdminSolanaSweep from "./pages/admin/SolanaSweep";
import MerchantDashboard from "./pages/merchant/Dashboard";
import MerchantUsers from "./pages/merchant/Users";
import MerchantWallets from "./pages/merchant/Wallets";
import MerchantTransactions from "./pages/merchant/Transactions";
import MerchantWithdraw from "./pages/merchant/Withdraw";
import MerchantSettings from "./pages/merchant/Settings";
import GatewayApiKey from "./pages/merchant/GatewayApiKey";
import GatewayApiDocs from "./pages/merchant/GatewayApiDocs";
import PaymentPage from "./pages/PaymentPage";

export default function App() {
  return (
    <Routes>
      <Route path="/pay/:token" element={<PaymentPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/admin" element={<AdminShell />}>
        <Route index element={<AdminDashboard />} />
        <Route path="merchants/new" element={<MerchantCreate />} />
        <Route path="merchants/:id/edit" element={<MerchantEdit />} />
        <Route path="merchants/:id" element={<MerchantDetail />} />
        <Route path="merchants" element={<AdminMerchants />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="transactions" element={<AdminTransactions />} />
        <Route path="withdrawals" element={<AdminWithdrawals />} />
        <Route path="tron-sweep" element={<AdminTronSweep />} />
        <Route path="solana-sweep" element={<AdminSolanaSweep />} />
        <Route path="activity" element={<AdminActivityLog />} />
        <Route path="profile" element={<Profile />} />
      </Route>
      <Route path="/m" element={<MerchantShell />}>
        <Route index element={<MerchantDashboard />} />
        <Route path="users" element={<MerchantUsers />} />
        <Route path="wallets" element={<MerchantWallets />} />
        <Route path="transactions" element={<MerchantTransactions />} />
        <Route path="withdraw" element={<MerchantWithdraw />} />
        <Route path="settings" element={<MerchantSettings />} />
        <Route path="api-key" element={<GatewayApiKey />} />
        <Route path="docs" element={<GatewayApiDocs />} />
        <Route path="profile" element={<Profile />} />
      </Route>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
