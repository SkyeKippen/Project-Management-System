# Project Management System

A small self-hosted phase board. Each project has phases shown as board columns (add, rename, reorder, delete), tasks shown as cards you drag between columns, and each task can have its own list of phases with a progress bar.

No dependencies beyond Node.js 18 or newer.

## Run

```bash
npm start
```

Then open http://127.0.0.1:3101.

| Variable | Default     | Purpose                    |
|----------|-------------|----------------------------|
| `PORT`   | `3101`      | Port to listen on          |
| `HOST`   | `127.0.0.1` | Interface to bind to       |

## Data

All state is stored in `data.json` next to `server.js`. It is created with sample data on first run and is not tracked by git, so back it up separately. Each save rewrites the whole file, and the last save wins: two open tabs can overwrite each other's changes.

## Hosting behind a Cloudflare Tunnel

The app has **no authentication of its own**. Anyone who can reach the port can read and edit everything.

- Keep the default `HOST=127.0.0.1` so the app is only reachable from this machine.
- Run `cloudflared` on the same host and point the tunnel's ingress at `http://127.0.0.1:3101`.
- Put a **Cloudflare Access** application (with an allow policy for the people who should get in) in front of the tunnel's hostname. Without Access, the tunnel makes the board public.
