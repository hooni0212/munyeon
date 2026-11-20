#!/bin/sh
# Certbot deploy hook: activate renewed preview certificates.
set -eu
case "${RENEWED_LINEAGE:-}" in
  /etc/letsencrypt/live/munyeon.*.sslip.io)
    /usr/sbin/nginx -t
    /usr/bin/systemctl reload nginx
    ;;
esac
