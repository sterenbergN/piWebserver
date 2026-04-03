# Interactive Resume Website

A lightweight full-stack portfolio and resume site built for **localhost** use and easy deployment on a **Raspberry Pi**.

## Features

- Interactive project gallery with filters
- Digital picture-frame slideshow mode for fullscreen display
- Raspberry Pi status dashboard for temperature, memory, storage, and uptime
- Animated hero and stats cards
- Experience timeline and skills sections
- Backend API serving resume data from `data/resume.json`
- Contact form that sends emails instead of storing messages locally
- Responsive layout for desktop, tablet, and mobile

## Run locally on this machine

> On this Windows setup, use `npm.cmd` because PowerShell blocks the `npm` script wrapper.

```powershell
cd n:\Code\WebServer
npm.cmd install
npm.cmd start
```

Open: `http://localhost:3000`

## Run on a Raspberry Pi

```bash
cd ~/WebServer
npm install
npm start
```

Then open:

- On the Pi: `http://localhost:3000`
- From another device on your network: `http://<your-pi-ip>:3000`

## Slideshow admin page

Open `http://localhost:3000/gallery.html` to manage the photo slideshow.

For a clean digital picture frame view, open:

- `http://localhost:3000/frame.html`
- Optional album filter: `http://localhost:3000/frame.html?album=work-projects`

For Raspberry Pi system stats, open:

- `http://localhost:3000/pi-status.html`

Default local login:

- **username:** `admin`
- **password:** `pi-resume-admin`

By default, image uploads now allow up to **50MB** per file.

> For your Raspberry Pi, change the password by setting `ADMIN_PASSWORD` before starting the server.

If you want to allow even larger uploads:

```bash
export MAX_UPLOAD_MB=100
npm start
```

On Windows PowerShell:

```powershell
$env:MAX_UPLOAD_MB="100"
npm.cmd start
```

## Raspberry Pi upload permissions fix

If you see an error like:

```text
EACCES: permission denied, open '/home/WebServer/public/uploads/...'
```

use a writable storage folder before starting the app:

```bash
mkdir -p /home/pi/.resume-site/uploads
export WEBSERVER_STORAGE_DIR=/home/pi/.resume-site
export ADMIN_PASSWORD="your-new-password"
npm start
```

If you want to keep using the project folder itself, fix ownership first:

```bash
sudo mkdir -p /home/WebServer/public/uploads
sudo chown -R $USER:$USER /home/WebServer
chmod -R u+rwX /home/WebServer/public/uploads /home/WebServer/data
```

## Cloudflare Tunnel setup

If you already have a Cloudflare Tunnel, point it to the local Node site on port `3000`.

Example config for `cloudflared` on the Pi:

```yaml
# /etc/cloudflared/config.yml
tunnel: YOUR_TUNNEL_ID
credentials-file: /etc/cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: resume.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

Useful commands:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl restart cloudflared
sudo systemctl status cloudflared
```

If you still need to map DNS for the hostname:

```bash
cloudflared tunnel route dns YOUR_TUNNEL_NAME resume.yourdomain.com
```

> If you expose the site publicly, keep the admin page protected and consider putting Cloudflare Access in front of `gallery.html`.

## Start on Raspberry Pi power-on

Create a `systemd` service so the website starts automatically on boot.

```ini
# /etc/systemd/system/resume-site.service
[Unit]
Description=Interactive Resume Website
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/WebServer
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=ADMIN_USERNAME=admin
Environment=ADMIN_PASSWORD=change-this-password
Environment=MAX_UPLOAD_MB=100
Environment=WEBSERVER_STORAGE_DIR=/home/pi/.resume-site
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now resume-site
sudo systemctl status resume-site
journalctl -u resume-site -f
```

If you want the picture frame to open automatically after desktop login, add Chromium kiosk mode to the Pi session startup:

```bash
chromium-browser --kiosk http://localhost:3000/frame.html
```

## Customize your content

Edit `data/resume.json` to update:

- your name and headline
- your real experience
- your project list
- your links and contact info

## Project structure

```text
WebServer/
├── data/
│   ├── messages.json
│   └── resume.json
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── package.json
└── server.js
```
