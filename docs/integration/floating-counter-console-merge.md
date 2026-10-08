# Merging the Floating Counter Console after ADR-074/075

`feature/floating-counter-console` (ADR-072) predates the realtime coalescing
in ADR-074. In its own `useOrganizationSocket`, every `token.*` and `queue.*`
event calls `invalidateQueries({ queryKey: ['counters', 'mine'] })`
directly. Merged as is, that would bring back one refetch per waiting person
for the own-counter query.

Measured locally: one Serve next with 200 people waiting, one live-queue tab
(`useMyCounter` is mounted there too).

| Code | API requests | `GET /api/counters/mine` | Bytes |
|---|---|---|---|
| Console branch as is | 603 | 200 | 3.49 MB |
| Trial merge resolved as below | 4 | 1 | 18.3 KB |

## Steps

```bash
git merge --no-ff feature/floating-counter-console
```

Two files conflict.

1. **`web-dashboard/src/hooks/useOrganizationSocket.ts`**: take this branch's
   version, then apply the console's two own-counter refreshes through the
   shared scheduler:

   ```bash
   git checkout --ours web-dashboard/src/hooks/useOrganizationSocket.ts
   git apply docs/integration/floating-counter-console-socket.patch
   ```

   The patch adds `scheduler.schedule(['counters', 'mine'])`:
   - in the `queue.*` case, because a deleted queue releases its counters'
     operators;
   - in `scheduleTokenViews`, which every token event uses, because the
     person at the signed-in person's counter may have changed.

   Nothing in the console calls `invalidateQueries` on events directly. The
   console's manual "Refresh" button and its reconnect re-read
   (`fetchQuery(myCounterQuery)`) are one-off user/reconnect actions and
   stay as they are.

2. **`docs/ARCHITECTURE_DECISIONS.md`**: keep both sides, ordered
   ADR-072 (console), then ADR-073, ADR-074, ADR-075.

`useOrganizationSocket.test.tsx` merges automatically. Update one assertion,
because the burst now also covers the own-counter key:

```diff
-      expect(invalidatedKeys().sort()).toEqual(['["dashboard"]', '["queue","q1"]', '["queues"]']);
+      expect(invalidatedKeys().sort()).toEqual(['["counters","mine"]', '["dashboard"]', '["queue","q1"]', '["queues"]']);
```

`useTokenActions.ts`, `useCounters.ts`, `useLiveToken.ts` and the console's
own files merge without conflict. The console's Serve next / Start /
Complete use `useTokenActions`, so they already go through the shared
scheduler.

## Verified on the trial merge (not pushed)

- Dashboard typecheck clean and lint clean.
- Dashboard tests: 639 of 640 pass. The exception is `App.test.tsx`, which
  fails only while a local backend is listening on :4000; it passes with the
  backend stopped.
- One Serve next at 200 waiting gives 4 requests and one own-counter
  refetch, as in the table above.
