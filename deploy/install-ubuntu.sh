#!/usr/bin/env bash
# Sets up the scanner on a fresh Ubuntu 22.04 or 24.04 server: a VPS with root
# access, or a free cloud VM (Oracle Cloud Always Free, Google Cloud e2-micro).
# Run it from inside the uploaded scanner folder:
#
#   cd ~/a11y-checklist-scanner
#   sudo bash deploy/install-ubuntu.sh scan.andryta.com you@example.com
#
# The two arguments are the host name the tool will answer on and the email
# address Let's Encrypt uses for certificate reminders. Both can be left out
# to skip Nginx and HTTPS (the scanner will then only answer on the server
# itself, on 127.0.0.1:4173).
#
# What it does, in order: installs Node.js 22 and a browser (Google Chrome on
# x86 servers; on ARM servers such as Oracle's Ampere machines, the Chromium
# build published by the Playwright project, since Google does not ship Chrome
# for ARM Linux); adds swap when the machine has little memory; copies this
# folder to /opt/a11y-checklist-scanner; installs the dependencies; creates the
# a11y user and the runs folder; installs and starts the systemd service; opens
# ports 80 and 443 in the machine's own firewall; configures Nginx for the host
# name and requests a certificate. Safe to run again after uploading a new
# version of the folder.
set -euo pipefail

HOST="${1:-}"
EMAIL="${2:-}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST=/opt/a11y-checklist-scanner
RUNS=/var/lib/a11y-scanner/runs
BROWSERS=/opt/browsers

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo."; exit 1; fi
if [ ! -f "$SRC/bin/a11y.js" ]; then echo "Run this from the scanner folder: sudo bash deploy/install-ubuntu.sh"; exit 1; fi

say() { printf '\n== %s\n' "$*"; }
ARCH="$(dpkg --print-architecture)"

say "System packages ($ARCH)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q curl ca-certificates gnupg unzip rsync fonts-liberation fonts-noto-color-emoji fonts-noto-cjk

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'parseInt(process.versions.node)')" -lt 18 ]; then
  say "Node.js 22 (from nodesource.com)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
echo "Node $(node -v)"

say "Browser"
CHROME=""
if [ "$ARCH" = "amd64" ]; then
  if [ ! -x /usr/bin/google-chrome-stable ]; then
    curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
    apt-get install -y -q /tmp/chrome.deb
    rm -f /tmp/chrome.deb
  fi
  CHROME=/usr/bin/google-chrome-stable
else
  # ARM: Chromium from the Playwright project, into a folder every user can read.
  mkdir -p "$BROWSERS"
  PLAYWRIGHT_BROWSERS_PATH="$BROWSERS" npx --yes playwright@1 install --with-deps chromium
  CHROME="$(find "$BROWSERS" -type f \( -name chrome -o -name chromium \) -path '*chrome-linux*' | sort | tail -1)"
  if [ -z "$CHROME" ]; then echo "Chromium did not install; look at the output above."; exit 1; fi
  chmod -R a+rX "$BROWSERS"
fi
echo "Browser: $CHROME"
"$CHROME" --version || true

# Little memory (a free 1 GB machine): give Chrome room to breathe.
MEM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
if [ "$MEM_MB" -lt 3000 ] && [ ! -f /swapfile ]; then
  say "Swap (the machine has ${MEM_MB} MB of memory)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "Scanner files → $DEST"
id -u a11y >/dev/null 2>&1 || useradd --system --home-dir /var/lib/a11y-scanner --shell /usr/sbin/nologin a11y
mkdir -p "$DEST" "$RUNS"
# Everything except runs, caches, build output and the desktop starters.
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude .cache --exclude runs --exclude .git --exclude .claude \
  --exclude '*.command' --exclude '*.bat' --exclude launcher --exclude '.DS_Store' \
  "$SRC/" "$DEST/"
cd "$DEST"
npm install --omit=dev --no-audit --no-fund --loglevel=error
chown -R a11y:a11y "$DEST" /var/lib/a11y-scanner

say "Service"
install -m 644 "$DEST/deploy/a11y-scanner.service" /etc/systemd/system/a11y-scanner.service
# The browser found above, whatever the unit file's default says.
mkdir -p /etc/systemd/system/a11y-scanner.service.d
printf '[Service]\nEnvironment=CHROME_PATH=%s\n' "$CHROME" > /etc/systemd/system/a11y-scanner.service.d/chrome.conf
systemctl daemon-reload
systemctl enable a11y-scanner >/dev/null
systemctl restart a11y-scanner
sleep 3
systemctl --no-pager --lines=0 status a11y-scanner | head -3

if [ -z "$HOST" ]; then
  say "No host name given: Nginx and HTTPS skipped. The scanner answers on 127.0.0.1:4173 on this machine."
else
  say "Firewall on this machine: allow 80 and 443"
  # Oracle Cloud images ship iptables rules that reject everything but SSH.
  if command -v iptables >/dev/null 2>&1 && iptables -S INPUT | grep -q -- '-j REJECT'; then
    iptables -C INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT
    command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save >/dev/null 2>&1 || true
  fi
  command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active' && ufw allow 'Nginx Full' >/dev/null || true

  say "Nginx for $HOST"
  apt-get install -y -q nginx
  sed "s/scan\.andryta\.com/$HOST/g" "$DEST/deploy/nginx-scan.conf" > "/etc/nginx/sites-available/$HOST"
  ln -sf "/etc/nginx/sites-available/$HOST" "/etc/nginx/sites-enabled/$HOST"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx

  if [ -n "$EMAIL" ]; then
    say "HTTPS certificate from Let's Encrypt"
    if ! command -v certbot >/dev/null 2>&1; then
      apt-get install -y -q snapd
      snap install core >/dev/null 2>&1 || true
      snap install --classic certbot
      ln -sf /snap/bin/certbot /usr/bin/certbot
    fi
    # Fails (harmlessly) until the DNS record for $HOST points at this server
    # and the cloud's own firewall lets ports 80 and 443 through.
    certbot --nginx --non-interactive --agree-tos --redirect -m "$EMAIL" -d "$HOST" \
      || echo "Certbot could not finish. Check that $HOST points at this server's public IP address and that the cloud firewall allows ports 80 and 443, then run: sudo certbot --nginx -d $HOST"
  else
    echo "No email given: HTTPS skipped. Later: sudo certbot --nginx -d $HOST"
  fi
fi

say "Done"
bash "$DEST/deploy/show-link.sh" "$HOST"
