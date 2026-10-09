---
name: offline-sync-engine
description: Dexie/IndexedDB schema, transactional commands, outbox push, server-seq pull, conflicts, clock checks and local backup. Use for src/db, src/sync or any new synced table.
---

# Offline sync engine

Each device sells from its own IndexedDB. Supabase aggregates. No device ever waits for the network.

Tables and local-only stores: `docs/DATABASE.md` §4. Command signatures: `docs/API.md` §6.

## 1. Commands (src/db/commands/*)
One exported function per business action (`postSale`, `postReturn`, `receivePurchase`, ...):
```ts
await db.transaction('rw', [db.salesInvoices, db.salesInvoiceLines, db.payments,
  db.stockMovements, db.partyLedger, db.cashMovements, db.numberSequences, db.outbox, db.auditLog], async () => {
  const number = await nextNumber('INV');           // inside the same tx
  // write document, lines, payments, ledger rows
  // write ONE outbox row per written record (or one per document with children embedded)
});
```
- Validate with `src/domain` BEFORE opening the transaction; the transaction only writes.
- Never `await fetch` inside a transaction (IndexedDB auto-commits on idle).
- Ids: `uuidv7()`; timestamps: ISO string from `nowIso()` (one helper, mockable in tests).

## 2. Outbox
Row: `{ seq (++auto), deviceSeq, table, id, op: 'upsert', payload, status: 'pending'|'sent'|'rejected', attempts, lastError, createdAt }`.
`deviceSeq` is a per-device monotonic counter stored in `syncState`.

## 3. Push
1. Read up to 200 `pending` rows ordered by `seq`.
2. `supabase.rpc('ingest_batch', { device_id, rows })`.
3. Server upserts by id (idempotent) and returns `{ accepted_up_to, rejected: [{ seq, code, message }] }`.
4. Mark accepted rows `sent`; rejected rows `rejected` with reason (shown on the manager's sync screen).
   A rejected row does not block later rows unless they reference it.
5. Network error → retry with backoff 5s, 30s, 2m, 10m, then every 10m. No max.

## 4. Pull
- Server assigns `server_seq` (bigint, global sequence) on every insert/update.
- Device keeps `lastServerSeq`; calls `rpc('pull_changes', { after_seq, limit: 1000 })` until empty.
- Master data (products, units, barcodes, customers, suppliers, settings, users) pulled fully.
  Documents of other devices: last 13 months on PC, 90 days on mobile (setting).
- Deletes arrive as tombstones (`deletedAt`), never hard deletes.
- After applying a pull page: rebuild affected derived balances (`stockBalances` cache) from ledgers.

## 5. Conflicts
| Data | Rule |
| --- | --- |
| Documents, lines, ledger rows | Append-only. Same id twice = same record → ignore duplicate. |
| Master data | Field-level merge: client sends `changedFields` + `baseVersion`; same field changed on both sides → newer server time wins, conflict logged. |
| Settings, users, roles | Server is the source of truth; offline edits rejected if server version is newer. |
| Derived balances | Never synced; always recomputed. |

## 6. Connectivity and clock
- `navigator.onLine === false` → offline. Otherwise heartbeat `rpc('ping')` every 30 s decides.
- Each successful sync stores `clockSkewMs = serverNow - deviceNow`.
- If device time < last recorded local time, or |skew| > 5 min: show warning, block opening a new shift.
- Status bar (always visible): online dot, pending count, last successful sync time.

## 7. Storage safety
- On first run: `navigator.storage.persist()`; show a warning if refused.
- `navigator.storage.estimate()` daily; alert at 80% usage.
- Local backup: on shift close and on demand → gzip JSON of all tables + `schemaVersion` + SHA-256,
  encrypted (AES-GCM, key from PBKDF2 of manager passphrase). Restore = upsert by id (no duplicates).
- Alert if any outbox row is pending > 24 h or last backup > 1 day.

## 8. Schema upgrades
- `db.version(n).stores(...)` + `.upgrade(tx => ...)` for every change; never edit an old version block.
- Server accepts payloads from the two previous app versions (`appVersion` sent in `ingest_batch`).

## 9. Adding a new synced table — checklist
1. Dexie store with indexes for query fields only (+ compound like `[productId+warehouseId]`).
2. Supabase migration: table with `company_id`, `server_seq`, `updated_at`, RLS (see `supabase-backend`).
3. Add the table to `ingest_batch` allow-list + validator, and to `pull_changes`.
4. Command writes outbox row in the same transaction.
5. Tests: integration (fake-indexeddb) for atomicity; e2e two-device scenario if it affects balances.

## 10. Tests that must exist
- Command atomicity: throw mid-transaction → nothing written.
- Push idempotency: send the same batch twice → one row server-side.
- Two devices offline sell the same product, then sync → both see identical balances.
- Pull with tombstone → record hidden on the other device.
