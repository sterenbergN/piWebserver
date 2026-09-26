# Pi-Dashboard

A local Next.js website hosted on a Raspberry Pi for dashboard purposes.

## Prerequisites

- Raspberry Pi (any model with sufficient resources)
- Node.js installed (version 18 or later recommended)
- npm or yarn package manager

## Installation

1. Clone the repository:
    ```
    git clone <repository-url>
    cd pi-dashboard
    ```

2. Install dependencies:
    ```
    npm install
    ```

3. Build the project:
    ```
    npm run build
    ```

## Running the Application

Start the development server:
```
npm run dev
```

For production, use:
```
npm start
```

Access the dashboard at `http://localhost:3000` (or your Pi's IP address).

## Configuration

Set these in the environment of the server process (e.g. a systemd unit or `.env.local`):

| Variable | Purpose |
| --- | --- |
| `PI_DASHBOARD_PASSWORD` | Admin password for `/login` (admin panel, uploads, backups). |
| `PI_DASHBOARD_SESSION_SECRET` | Secret used to sign admin sessions. |
| `WORKOUT_SESSION_SECRET` | Secret used to sign workout-tracker logins. |
| `SITE_URL` | Public address, e.g. `https://example.com` — used for link previews, the sitemap and robots.txt. |
| `BACKUP_DIR` | Default backup folder (can be changed in Admin → Backups), e.g. a USB drive. |
| `NEXT_DIST_DIR` | Optional build output folder (defaults to `.next`). |

## Where data lives

- `.data/` — private data: workouts, party rooms and prompts, analytics, stats history, backup settings.
- `public/content/` — home page / resume content (edited at `/admin/resume`).
- `public/uploads/` — blog posts, gallery and library files.

**Backups:** Admin → Backups zips all of the above (photos and PDFs optional) every night into
the backup folder and keeps the newest copies. You can also back up on demand, download,
upload and restore there; a restore always takes a safety backup first.

## Tests

```
npm test
```

## Important Notes

This project uses a custom Next.js version with breaking changes. APIs, conventions, and file structure may differ from standard Next.js. Always read the relevant guide in `node_modules/next/dist/docs/` before making code changes. Heed any deprecation notices.

## Contributing

Please refer to the project guidelines for contributions.

## License

MIT Open License