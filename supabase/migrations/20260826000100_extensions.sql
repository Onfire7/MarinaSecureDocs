-- Extensions. Everything else in this migration set assumes these exist.
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_cron;    -- Activity Log retention (see 1600)
