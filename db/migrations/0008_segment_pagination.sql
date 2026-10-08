-- Apply without a transaction on each environment. Existing prefix index does
-- not contain the UUID tie-breaker needed for bounded cursor reads.
create index concurrently if not exists segments_user_thread_created_id_idx
  on segments (user_id, thread_id, created_at desc, id desc);
