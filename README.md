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
| `SITE_URL` | Public address (default `https://noahstuf.com`) — used for link previews, the sitemap, RSS and robots.txt. |
| `BACKUP_DIR` | Default backup folder (can be changed in Admin → Backups), e.g. a USB drive. |
| `NEXT_DIST_DIR` | Optional build output folder (defaults to `.next`). |

## Raspberry Pi: updates without unplugging anything

Every push to `master` makes GitHub Actions build the site **on a 64-bit ARM
machine (same as the Pi)**, run the tests, smoke-test the build, sign a build
attestation and publish it as a GitHub release. The Pi installs releases with
`scripts/deploy.sh`:

- downloads over HTTPS from GitHub and checks the release's SHA-256 (and, if the
  `gh` CLI is installed, GitHub's build attestation — proof it was built by this
  repo's workflow);
- unpacks into `releases/<tag>/`, then switches `current` with an atomic
  symlink swap and reloads pm2;
- health-checks the new build (`/api/health`) and **rolls back automatically**
  if it doesn't come up;
- keeps site data in `shared/`, outside every release, so an update can't touch it.

Needs 64-bit Raspberry Pi OS (`uname -m` → `aarch64`), Node 22, pm2, curl.

### Layout on the site USB

```
/mnt/site/noahstuf/            ← APP_DIR
  deploy.sh
  ecosystem.config.cjs         (written by deploy.sh)
  current -> releases/build-…  (what pm2 runs)
  releases/                    (last 3 builds, code only)
  shared/
    env                        (settings, one KEY=value per line)
    data/  uploads/  content/  cache/  backups/
```

### One-time switch-over

```bash
# 1. Make the folder and grab the script
mkdir -p /mnt/site/noahstuf && cd /mnt/site/noahstuf
curl -fsSLO https://raw.githubusercontent.com/sterenbergN/piWebserver/master/scripts/deploy.sh
chmod +x deploy.sh

# 2. Copy data from the old install (the old folder is left untouched)
./deploy.sh --migrate /path/to/old/piWebserver

# 3. Put settings in shared/env, e.g.
#    PI_DASHBOARD_PASSWORD=...
#    PI_DASHBOARD_SESSION_SECRET=...
#    WORKOUT_SESSION_SECRET=...
#    SITE_URL=https://noahstuf.com
#    BACKUP_DIR=/mnt/backup/noahstuf

# 4. Stop the old pm2 app, install the latest build, save pm2's process list
pm2 delete <old-app-name>
./deploy.sh
pm2 save
```

### Updating

- **From the site:** Admin → Updates → *Install build-…* (the page reloads when it's live).
- **From a shell:** `./deploy.sh` · `./deploy.sh --check` · `./deploy.sh --status`
  · `./deploy.sh --rollback` · `./deploy.sh build-20260926-1a2b3c4` (a specific build).
- **Automatically**, e.g. every night at 4:10 (`crontab -e`):
  `10 4 * * * cd /mnt/site/noahstuf && ./deploy.sh >> deploy.log 2>&1`

### Mounting the USB drives reliably

Mount both drives by UUID in `/etc/fstab` so they always land in the same place
(find the UUIDs with `sudo blkid`):

```
UUID=<site-usb-uuid>    /mnt/site    ext4  defaults,noatime                                    0 2
UUID=<backup-usb-uuid>  /mnt/backup  ext4  defaults,noatime,nofail,x-systemd.device-timeout=10s  0 2
```

(For exFAT drives use `exfat defaults,uid=1000,gid=1000,...` instead of `ext4 defaults`.)
`nofail` lets the Pi boot without the backup drive. Make pm2 wait for the site
drive so the site never starts before it's mounted:

```bash
sudo systemctl edit pm2-$USER     # then add:
# [Unit]
# RequiresMountsFor=/mnt/site
```

With `BACKUP_DIR` on the second USB and *Only back up when this folder is on a
different drive* ticked (Admin → Backups), backups refuse to run — and say so —
if the backup USB is unplugged, instead of silently filling the site drive.

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