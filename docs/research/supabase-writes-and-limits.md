# Supabase transactional writes, Version snapshots and upload limits

Researched 2026-09-30 for ticket #3. Facts and trade-offs only; no decision is made here. Package claims were checked against the versions installed in this repo (`next` 16.3.7, `@supabase/supabase-js` 2.117.2). Web sources are linked inline and were read on the same date. Fixture sizes were measured with a throwaway script (openpyxl, outside the repo).

## 1. Fixture sizes (the workload)

"Tree rows" = 1 template + sections + items + comments (the draft schema in `docs/plan.md`), excluding `comment_photos`, `import_runs` and `import_issues`.

| Fixture | File bytes | Comments | Sections | Items | Tree rows | `Comment Text` bytes (UTF-8) | All cell bytes |
|---|---|---|---|---|---|---|---|
| Ben Gromicko's Template | 182,834 | 1,248 | 17 | 133 | **1,399** | **255,663** | 397,930 |
| Room-by-Room Residential | 104,950 | 798 | 22 | 136 | 957 | 104,041 | 187,805 |
| InterNACHI Commercial | 57,951 | 406 | 15 | 67 | 489 | 50,281 | 97,306 |
| Residential Template | 55,686 | 395 | 13 | 70 | 479 | 51,708 | 94,825 |
| InterNACHI Residential | 55,565 | 392 | 13 | 69 | 475 | 51,708 | 94,571 |
| Radon Inspection | 7,155 | 10 | 2 | 3 | 16 | 1,298 | 2,014 |

Ben also has 25 non-empty default-photo URL cells (future `comment_photos` rows).

JSON size of the largest tree (Ben), as a payload or a snapshot:

- Nested `{sections:[{items:[{comments:[...]}]}]}` with short keys, non-empty fields only: **463,778 bytes**; gzip: 79,866 bytes.
- Flat array of 1,248 objects keyed by the verbose 42-column headers: 854,999 bytes.

So the biggest realistic import payload or Version snapshot is roughly 0.5-0.9 MB of JSON, and every fixture file is under 0.2 MB.

## 2. Writing a whole tree atomically

### a. Postgres function called with `supabase.rpc()` and a `jsonb` argument

- PostgREST runs **every request inside a transaction**, commits on success and rolls back on failure ([PostgREST: Transactions](https://docs.postgrest.org/en/stable/references/transactions.html)). An RPC is one request, so everything the function does is atomic.
- POST to a `volatile` function runs `READ WRITE`. GET, or POST to a `stable`/`immutable` function, runs `READ ONLY` (same page). The write function must stay `volatile` (the default).
- The installed postgrest-js says so directly: "supabase-js does not group multiple queries into one transaction. For multi-statement transactional logic, use a database function (`supabase.rpc(...)`)" (`node_modules/@supabase/postgrest-js/dist/index.d.mts`, `rollback()` docstring). A Supabase maintainer says generic client-side transactions are "not a priority for the PostgREST team given that rpc works well" ([supabase discussion #526](https://github.com/orgs/supabase/discussions/526)).
- Inside the function, `jsonb_to_recordset`, `jsonb_populate_recordset` and `jsonb_array_elements ... WITH ORDINALITY` expand the JSON into rows ([Postgres: JSON functions](https://www.postgresql.org/docs/current/functions-json.html)). Ordinality can supply `position` from array order. A function cannot `COMMIT` part-way; only `CALL`/`DO` can control transactions ([Postgres: PL/pgSQL transaction management](https://www.postgresql.org/docs/current/plpgsql-transactions.html)).
- **Timeouts.** Supabase defaults: `anon` 3s, `authenticated` 8s, `service_role` none (so the `authenticator` role's 8s applies), `postgres` none (capped at 2 min globally). Timeouts for Data API (supabase-js) calls can be raised up to **60s**. For longer work Supabase points to Supavisor or direct connections ([Supabase: Timeouts](https://supabase.com/docs/guides/database/postgres/timeouts)). Inserting about 1.4k rows from one jsonb argument is unlikely to take seconds, but this is **not measured**.
- **RLS.** Functions default to `security invoker` (Supabase's recommended practice), so the caller's RLS policies apply. A `security definer` function runs as its owner and must set `search_path` ([Supabase: Database functions](https://supabase.com/docs/guides/database/functions)). A secret (service_role) key bypasses RLS only when the request carries no user access token ([Supabase: RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)). By default any role can execute a function, so `revoke execute` or grant it explicitly (Database functions page).
- **Payload size.** I found **no documented request-body limit** for the Supabase Data API or PostgREST in first-party docs. This is unverified: the ~0.5-0.9 MB Ben payload should be tested against a real project before relying on it.
- Trade-offs: atomic, one round trip, works over HTTPS (no pooler or IPv4 concerns), and it's the path Supabase recommends. Against: logic lives in SQL/plpgsql migrations (typed less strictly, and Vitest can't test it without a database), the jsonb shape is a second contract to keep in sync with the TypeScript tree, and returning the generated ids needs care.

### b. Plain supabase-js inserts

- **One** `.insert([...])` call with an array is one request, therefore one transaction and one `INSERT` statement. The postgrest-js docs say "A bulk create operation is handled in a single transaction. If any of the inserts fail, none of the rows are inserted" (`index.d.mts`, `insert()` docstring). PostgREST says a JSON-array body "uses a single INSERT statement on the back-end" and needs "all-matching keys" ([PostgREST: Tables and views, bulk insert](https://docs.postgrest.org/en/stable/references/api/tables_views.html)).
- **Several** calls (templates, then sections, then items, then comments) are separate requests and separate transactions. There is no cross-call rollback (postgrest-js docstring above). A failure half-way leaves a partial tree, unless the app compensates, for example by deleting the template and relying on `ON DELETE CASCADE`, or by writing to a `status = 'importing'` flag and flipping it last.
- Children need parent ids. You either pre-generate UUIDs client-side (then all four inserts can be built up front, but they are still four transactions) or do round trips with `.select()`.
- Trade-offs: no SQL to maintain and fully typed via generated types, but it isn't atomic across tables. It takes 4+ round trips, and Duplicate has the same problem.

### c. Direct Postgres driver (postgres.js / node-postgres) against Supabase

- Endpoints: the direct connection is IPv6 (IPv4 only with the paid add-on). Shared Supavisor pooler: port **5432 = session mode**, **6543 = transaction mode**, and it is "IPv4-only on every plan" ([Supabase: Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)).
- Transaction mode is the one Supabase recommends for serverless and edge functions, "which open many short-lived connections". It "returns your connection to the pool after each transaction", so a `BEGIN ... COMMIT` block works, but session state does not survive between transactions. That rules out prepared statements (must be turned off), `SET`, advisory locks, `LISTEN`, temp tables and query pipelining (same page).
- Supabase's serverless guidance for postgres.js: create the client once at module scope, `max: 1`, `prepare: false`, port 6543. It warns that postgres.js "pipelines queries by default, so this combination can hang queries or return mismatched rows" ([Supabase: Serverless drivers](https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers)).
- postgres.js: `sql.begin` "will reserve a connection for the transaction", with automatic rollback on error. Passing an array of objects to `sql()` builds one multi-row `insert` ([postgres.js README](https://github.com/porsager/postgres)). node-postgres: you "must use the same client instance for all statements within a transaction" and must not use `pool.query` for transactions ([node-postgres: Transactions](https://node-postgres.com/features/transactions)).
- **Timeouts:** not subject to the 60s Data API cap (see the Timeouts page), but the `postgres` role's 2 min global cap still applies unless it's changed.
- **RLS:** you connect as a database role (usually `postgres`, the table owner), not through PostgREST's JWT impersonation, so RLS policies written for `anon`/`authenticated` do not apply unless you set the role and claims yourself. Supabase docs describe the service role's `bypassrls`, but I did not find a first-party statement specifically about pooler connections and RLS. This follows from Postgres role semantics and isn't separately cited.
- Trade-offs: real multi-statement transactions written in TypeScript. There's no payload cap beyond the function's own request body, and the same code can serve Duplicate. Against: a new dependency plus a `DATABASE_URL` secret, and pooler-mode footguns (prepared statements, pipelining). Each warm Vercel instance holds a connection, and RLS is out of the picture.

## 3. Storing Versions (read-only snapshot per Save)

Postgres limits that matter: any TOAST-able value (including `jsonb`) can be up to **1 GB**. Values in rows over about **2 kB** are compressed (pglz or lz4) and/or moved out of line ([Postgres: TOAST](https://www.postgresql.org/docs/current/storage-toast.html)). The Supabase Free plan has **500 MB** of database per project ([Supabase: Billing](https://supabase.com/docs/guides/platform/billing-on-supabase)).

| Pattern | Size per Save (Ben, largest) | Write | Read / query | Notes |
|---|---|---|---|---|
| **jsonb document per Version** (`template_versions(template_id, number, snapshot jsonb, created_at)`) | 1 row; ~464 KB raw JSON, TOAST-compressed on disk (gzip of same: 80 KB, a rough proxy only) | Build the JSON in TS or with `jsonb_build_object`/`jsonb_agg` in SQL, and insert 1 row | Viewing a Version = read 1 row. Searching or diffing inside history needs jsonb operators. Restoring = expand jsonb back into rows (same code path as import option 2a) | Snapshot is immutable by construction. Its shape is a second schema that can drift from the live tables, so it needs a `schema_version` field |
| **Row copies per Version** (`sections/items/comments` carry `version_id`, or parallel `*_versions` tables) | ~1,399 rows per Save (100 Saves = ~140k rows) | `INSERT ... SELECT` per table inside one transaction | Same queries and types as live data; a diff is SQL joins | Row counts grow with Saves times tree size. Read-only needs enforcing (RLS or triggers). Every schema change touches the version tables too |
| **Live rows + change log / diffs** | Only changed fields per Save | Record edits as events | Rebuilding Version N means replaying events | More code. Shown for completeness |
| **Hybrid**: live editable rows + jsonb snapshot on Save | as jsonb | as jsonb | Live editing uses rows, history uses documents | The combination the Glossary's "Version 1 = exactly as imported" can map onto. Restore creates a new Version |

Rough budget: at about 0.1-0.5 MB per Ben-sized Version, 500 MB holds on the order of 1,000-5,000 such snapshots. That's an estimate, not measured on Postgres.

## 4. Upload size limits

- **Server Actions:** default body limit **1 MB**, configurable via `experimental.serverActions.bodySizeLimit` (e.g. `'2mb'`). The limit counts the raw body, including multipart overhead ("10–20 KB is a reasonable rule of thumb") (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md`; also `02-guides/server-actions.md`).
- **Route handlers:** the Next 16 docs define no body-size option for App Router route handlers. You read `request.formData()` directly, and "you do not need to use `bodyParser`" (`01-app/03-api-reference/03-file-conventions/route.md`). If a `proxy.ts` exists, Next buffers request bodies up to `experimental.proxyClientMaxBodySize` (default **10 MB**). Beyond that it **silently truncates** and logs a warning rather than failing (`.../next-config-js/proxyClientMaxBodySize.md`).
- **Vercel platform:** max request *or* response body for a Vercel Function is **4.5 MB**, and larger bodies get `413 FUNCTION_PAYLOAD_TOO_LARGE`. Max duration (Fluid compute) is 300s default and max on Hobby, and 300s default / 800s max on Pro ([Vercel: Functions limits](https://vercel.com/docs/functions/limitations)). This applies to Server Actions and route handlers alike, since both run as Vercel Functions.
- **Fit:** the largest fixture is 183 KB, about 18% of the default 1 MB Server Action limit and about 4% of Vercel's 4.5 MB cap. The 42 columns are fixed, so a file only grows with more rows or longer HTML. A 1 MB `.xlsx` would be about 5.5x Ben (about 7k comments), assuming the same compression ratio.

### Alternatives if limits bite

- **Direct upload to Supabase Storage:** `createSignedUploadUrl` gives a token-scoped URL that uploads "without further authentication" and is "valid for 2 hours". The client then calls `uploadToSignedUrl`, and the server reads the object by path (`node_modules/@supabase/storage-js/dist/index.d.mts`). Storage file-size cap: Free plan up to 50 MB, Pro up to 500 GB, per-bucket limits below that ([Supabase: File limits](https://supabase.com/docs/guides/storage/uploads/file-limits)). Vercel's own guidance for >4.5 MB is to upload directly from the browser to storage ([Vercel KB: bypass 4.5MB](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)). Bonus: this keeps the original file for the Import run's audit trail. Cost: an extra bucket, policies and a second step.
- **Client-side parse:** parse the `.xlsx` in the browser and send the tree as JSON. This avoids the file limit but not the body limit: Ben's tree is about 0.46-0.85 MB of JSON, more than the file itself (183 KB compressed xlsx). It also puts the parser in the client bundle and means the server must re-validate the tree, since it can't trust a client-parsed tree as an Import run's source of truth. It also loses a server-side sha256 of the original bytes, unless the client sends that too.
- **Raise `bodySizeLimit`:** available up to Vercel's 4.5 MB ceiling.

Note that the section 2 options stack with these: an RPC payload is JSON, so the parsed tree (not the file) is what hits any Data API body limit. That limit is undocumented (section 2a).
