#!/bin/bash
# deploy.sh — Build KroomPrint frontend dari amba menggunakan Node v20
# Jalankan lewat SSH ke amba: ssh amba@100.90.80.85 'bash /mnt/web/Nouvem/printer-wireless/deploy.sh'
# Atau langsung dari amba: bash ~/printer-wireless/deploy.sh

set -e

PROJ="/mnt/web/Nouvem/printer-wireless"

echo "[1/3] Loading Node v20 via nvm..."
export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
source "$NVM_DIR/nvm.sh"
nvm use 20
echo "  → Node: $(node --version)"

echo "[2/3] Building frontend (Vite)..."
# Hapus dist lama supaya Vite tidak error permission denied saat scandir
rm -rf "$PROJ/dist"
cd "$PROJ"
npm run build

echo "[3/3] Fixing permissions + restarting PM2..."
chmod -R 755 "$PROJ/dist"
pm2 restart kroomprint-web

echo ""
echo "✓ Deploy selesai!"
echo "  Frontend: http://$(hostname -I | awk '{print $1}'):5174"
echo "  Backend : http://$(hostname -I | awk '{print $1}'):8088"
