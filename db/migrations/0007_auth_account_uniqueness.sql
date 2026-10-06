-- Also enforce account identity on databases that already applied 0006.
-- If duplicate provider/account pairs exist, resolve them before running this
-- migration; do not silently delete linked credentials.
create unique index if not exists auth_accounts_provider_account_idx
  on public.auth_accounts (provider_id, account_id);
