-- Admins typically want the global Users/Transactions lists scoped to live data by default.
UPDATE "admin_users" SET "portal_environment" = 'live' WHERE "role" = 'ADMIN';
