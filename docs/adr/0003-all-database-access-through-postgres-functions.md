# All database access goes through Postgres functions, called by the server only

Every read and write goes through a plpgsql function, called with one `supabase.rpc()` from server code using the service-role key. Each write (Import, Save, Duplicate, Restore, Rename, Delete, and Seed's wipe) is one function, so it runs in one transaction: PostgREST wraps each request in a transaction, and supabase-js can't group several calls into one. Duplicate and Restore copy rows with `INSERT … SELECT` inside the database, so no tree crosses the wire. Each read (a Version's tree, an Import run's evidence, the Template list) is also a function, and returns one `jsonb` value. The Data API caps responses at 1,000 rows by default, and Ben has 1,248 Comments and 1,248 Source rows, so plain selects would be cut off silently. There's no auth: RLS is on for every table with no policies, `execute` is revoked from `public`, `anon` and `authenticated` on every function and granted to `service_role`, and the browser never holds a Supabase client or key.

## Considered Options

- **Several supabase-js inserts per write.** Rejected: each call is its own transaction, so a failure half-way leaves a partial tree.
- **postgres.js transactions in TypeScript** through the transaction-mode pooler. Rejected: a second connection path and secret, prepared statements and pipelining must be turned off, and it adds a dependency for what one function call already gives.
- **Nested PostgREST selects for reads**, with Max rows raised. Rejected: correctness would depend on a project setting that is easy to miss on the prod project, and ordering by `position` would be spread over each embed.

## Consequences

- The jsonb shapes the functions take and return are a second contract beside core's zod tree schema. `src/db` validates every result against it, and a fixture test round-trips Import → read.
- Logic in plpgsql can't be tested by Vitest without a database. How those tests run is decided in Verification strategy (issue #14).
- The service-role key is the only credential, and it's server-only. A leaked anon key reads nothing.
