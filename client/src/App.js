import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import AdminLoginPage from "./pages/AdminLoginPage";
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
import AdminWallets from "./pages/admin/AdminWallets";
import AdminTransactions from "./pages/admin/Transactions";
import AdminWithdrawals from "./pages/admin/Withdrawals";
import AdminActivityLog from "./pages/admin/ActivityLog";
import AdminSystemSettings from "./pages/admin/SystemSettings";
import AdminUnifiedSweep from "./pages/admin/UnifiedSweep";
import MerchantDashboard from "./pages/merchant/Dashboard";
import MerchantUsers from "./pages/merchant/Users";
import MerchantWallets from "./pages/merchant/Wallets";
import MerchantTransactions from "./pages/merchant/Transactions";
import MerchantWithdraw from "./pages/merchant/Withdraw";
import MerchantSettings from "./pages/merchant/Settings";
import GatewayApiKey from "./pages/merchant/GatewayApiKey";
import GatewayApiDocs from "./pages/merchant/GatewayApiDocs";
import PaymentPage from "./pages/PaymentPage";

/** Bookmarked `/admin/...` → `/control/...` */
function RedirectAdminToControl() {
  const { pathname } = useLocation();
  const suffix = pathname.startsWith("/admin/") ? pathname.slice("/admin/".length) : "";
  const to = suffix ? `/control/${suffix}` : "/control";
  return <Navigate to={to} replace />;
}

/** Bookmarked `/m/...` → `/...` (merchant app lives at `/`) */
function RedirectMToRoot() {
  const { pathname } = useLocation();
  const suffix = pathname.startsWith("/m/") ? pathname.slice("/m/".length) : "";
  const to = suffix ? `/${suffix}` : "/";
  return <Navigate to={to} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/pay/:token" element={<PaymentPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/control/login" element={<AdminLoginPage />} />
      <Route path="/control" element={<AdminShell />}>
        <Route index element={<AdminDashboard />} />
        <Route path="merchants/new" element={<MerchantCreate />} />
        <Route path="merchants/:id/edit" element={<MerchantEdit />} />
        <Route path="merchants/:id" element={<MerchantDetail />} />
        <Route path="merchants" element={<AdminMerchants />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="wallets" element={<AdminWallets />} />
        <Route path="transactions" element={<AdminTransactions />} />
        <Route path="withdrawals" element={<AdminWithdrawals />} />
        <Route path="sweep" element={<AdminUnifiedSweep />} />
        <Route path="tron-sweep" element={<Navigate to="/control/sweep" replace />} />
        <Route path="evm-usdt-sweep" element={<Navigate to="/control/sweep" replace />} />
        <Route path="solana-sweep" element={<Navigate to="/control/sweep" replace />} />
        <Route path="activity" element={<AdminActivityLog />} />
        <Route path="settings" element={<AdminSystemSettings />} />
        <Route path="profile" element={<Profile />} />
      </Route>
      <Route path="/admin" element={<Navigate to="/control" replace />} />
      <Route path="/admin/*" element={<RedirectAdminToControl />} />
      <Route path="/m" element={<Navigate to="/" replace />} />
      <Route path="/m/*" element={<RedirectMToRoot />} />
      <Route path="/" element={<MerchantShell />}>
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
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
