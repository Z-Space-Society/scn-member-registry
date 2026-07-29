# scn-manage

Membership SPA for the Shared Computer Network co-op. See HANDOVER.md for
design decisions, LEARNINGS.md for HappyView behavior, CLAUDE.md for
architecture invariants.

## Development

```sh
cp .env.example .env   # fill in the hvc_ client key
npm install
npm run dev
```

Open `http://127.0.0.1:5173` — the loopback IP, not `localhost`, and not a
custom hosts entry: the OAuth redirect URI must match exactly, and Web Crypto
requires a hostname the browser treats as a secure context.

Keep DevTools open with "Disable cache" ticked; browsers serve stale JS
modules on loopback otherwise.

## Layout

- `src/` — SPA source. `tests/` mirrors it.
- `lexicons/` — lexicon JSON, uploaded to the HappyView instance.
- `lua/` — HappyView Lua scripts, deployed via the Admin API. Script env vars
  (`LITELLM_MASTER_KEY`, `SERVICE_DID`, ...) are set in the HappyView
  dashboard, never committed here.
- `mockup/` — design concept, not a spec.

## Testing

```sh
npm test
```
