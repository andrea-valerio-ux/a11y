#!/usr/bin/env bash
# Prints the link to open the scanner with. The scanner mints a new token each
# time it starts and prints it in its log; this reads it back and swaps the
# loopback address for the public host name.
#
#   bash deploy/show-link.sh scan.andryta.com
HOST="${1:-}"
LINE="$(journalctl -u a11y-scanner --no-pager -o cat 2>/dev/null | grep -o 'http://127.0.0.1:[0-9]*/?token=[0-9a-f]*' | tail -1)"
if [ -z "$LINE" ]; then
  echo "The scanner has not printed a link yet. Is it running?  sudo systemctl status a11y-scanner"
  exit 1
fi
if [ -n "$HOST" ]; then
  echo "Open the scanner at:"
  echo "  https://$HOST/${LINE#*://*/}"
  echo "(the part after ?token= changes every time the service restarts)"
else
  echo "On this machine: $LINE"
fi
