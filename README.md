# Project Management System

A small self-hosted phase board, organised as **Project → Major Phases → Stages → Cards**:

- **Major phases** are tabs across the top of the board (add, rename, reorder, delete). The selected tab is remembered per project.
- **Stages** are rows stacked top to bottom inside a major phase (add, rename, move up/down, delete).
- **Cards** (tasks) flow left to right within a stage and wrap onto new lines. Drag them within a stage, between stages, or onto another major phase's tab, which moves the card to that phase's first stage.
- Each task can also have its own list of phases, with a progress bar on the card.

Data saved by older versions (project phases as columns) is migrated on load: the old columns become the stages of a single major phase named "Phase 1".

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
