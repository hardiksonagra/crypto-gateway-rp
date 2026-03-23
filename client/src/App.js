import { Navigate, Route, Routes } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import AdminShell from "./layouts/AdminShell";
import MerchantShell from "./layouts/MerchantShell";
import AdminDashboard from "./pages/admin/Dashboard";
import AdminMerchants from "./pages/admin/Merchants";
import MerchantCreate from "./pages/admin/MerchantCreate";
import MerchantEdit from "./pages/admin/MerchantEdit";
import AdminUsers from "./pages/admin/Users";
import AdminTransactions from "./pages/admin/Transactions";
import AdminWithdrawals from "./pages/admin/Withdrawals";
import MerchantDashboard from "./pages/merchant/Dashboard";
import MerchantUsers from "./pages/merchant/Users";
import MerchantTransactions from "./pages/merchant/Transactions";
import MerchantWithdraw from "./pages/merchant/Withdraw";
import MerchantSettings from "./pages/merchant/Settings";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin" element={<AdminShell />}>
        <Route index element={<AdminDashboard />} />
        <Route path="merchants/new" element={<MerchantCreate />} />
        <Route path="merchants/:id/edit" element={<MerchantEdit />} />
        <Route path="merchants" element={<AdminMerchants />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="transactions" element={<AdminTransactions />} />
        <Route path="withdrawals" element={<AdminWithdrawals />} />
      </Route>
      <Route path="/m" element={<MerchantShell />}>
        <Route index element={<MerchantDashboard />} />
        <Route path="users" element={<MerchantUsers />} />
        <Route path="transactions" element={<MerchantTransactions />} />
        <Route path="withdraw" element={<MerchantWithdraw />} />
        <Route path="settings" element={<MerchantSettings />} />
      </Route>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
