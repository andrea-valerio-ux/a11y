#!/usr/bin/env bash
# Sets up the scanner on a fresh AlmaLinux 9 (or Rocky Linux 9) server, which
# is what HostGator's NVMe VPS plans come with. Order the plan WITHOUT cPanel:
# cPanel's own web server would occupy ports 80 and 443.
#
#   cd ~/a11y-checklist-scanner
#   sudo bash deploy/install-almalinux.sh scan.andryta.com you@example.com
#
# Same arguments and same result as deploy/install-ubuntu.sh: Node.js 22,
# Google Chrome, swap on small machines, the scanner in /opt, a service that
# starts at boot, Nginx for the host name, an HTTPS certificate, and the link.
set -euo pipefail

HOST="${1:-}"
EMAIL="${2:-}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST=/opt/a11y-checklist-scanner
RUNS=/var/lib/a11y-scanner/runs

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo."; exit 1; fi
if [ ! -f "$SRC/bin/a11y.js" ]; then echo "Run this from the scanner folder: sudo bash deploy/install-almalinux.sh"; exit 1; fi
if [ "$(uname -m)" != "x86_64" ]; then echo "This script expects an x86_64 machine (Google Chrome is only published for that). For ARM use deploy/install-ubuntu.sh on Ubuntu."; exit 1; fi

say() { printf '\n== %s\n' "$*"; }

say "System packages"
dnf install -y -q epel-release
dnf install -y -q curl ca-certificates unzip rsync policycoreutils-python-utils \
  liberation-fonts google-noto-emoji-color-fonts google-noto-sans-cjk-fonts

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'parseInt(process.versions.node)')" -lt 18 ]; then
  say "Node.js 22 (from nodesource.com)"
  curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
  dnf install -y -q nodejs
fi
echo "Node $(node -v)"

if [ ! -x /usr/bin/google-chrome-stable ]; then
  say "Google Chrome"
  dnf install -y -q https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm
fi
CHROME=/usr/bin/google-chrome-stable
echo "Chrome $($CHROME --version)"

# Little memory (a 2 GB plan): give Chrome room to breathe.
MEM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
if [ "$MEM_MB" -lt 3000 ] && [ ! -f /swapfile ]; then
  say "Swap (the machine has ${MEM_MB} MB of memory)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "Scanner files → $DEST"
id -u a11y >/dev/null 2>&1 || useradd --system --home-dir /var/lib/a11y-scanner --shell /sbin/nologin a11y
mkdir -p "$DEST" "$RUNS"
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude .cache --exclude runs --exclude .git --exclude .claude \
  --exclude '*.command' --exclude '*.bat' --exclude launcher --exclude '.DS_Store' \
  "$SRC/" "$DEST/"
cd "$DEST"
npm install --omit=dev --no-audit --no-fund --loglevel=error
chown -R a11y:a11y "$DEST" /var/lib/a11y-scanner

say "Service"
install -m 644 "$DEST/deploy/a11y-scanner.service" /etc/systemd/system/a11y-scanner.service
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
  say "Nginx for $HOST"
  dnf install -y -q nginx
  # RHEL-family Nginx reads /etc/nginx/conf.d/*.conf; there is no sites-enabled.
  sed "s/scan\.andryta\.com/$HOST/g" "$DEST/deploy/nginx-scan.conf" > "/etc/nginx/conf.d/$HOST.conf"
  # SELinux: let Nginx talk to the scanner on the loopback port.
  command -v setsebool >/dev/null 2>&1 && setsebool -P httpd_can_network_connect 1 || true
  nginx -t
  systemctl enable nginx >/dev/null
  systemctl restart nginx

  if systemctl is-active --quiet firewalld; then
    say "Firewall: allow 80 and 443"
    firewall-cmd --permanent --add-service=http --add-service=https >/dev/null
    firewall-cmd --reload >/dev/null
  fi

  if [ -n "$EMAIL" ]; then
    say "HTTPS certificate from Let's Encrypt"
    dnf install -y -q certbot python3-certbot-nginx
    certbot --nginx --non-interactive --agree-tos --redirect -m "$EMAIL" -d "$HOST" \
      || echo "Certbot could not finish. Check that $HOST points at this server's IP address, then run: sudo certbot --nginx -d $HOST"
    systemctl enable --now certbot-renew.timer >/dev/null 2>&1 || true
  else
    echo "No email given: HTTPS skipped. Later: sudo certbot --nginx -d $HOST"
  fi
fi

say "Done"
bash "$DEST/deploy/show-link.sh" "$HOST"
