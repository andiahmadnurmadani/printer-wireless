# Setup Epson L3210 di pc-hitam — Install Driver Resmi

> Jalankan di **terminal pc-hitam langsung** (bukan SSH dari Windows, karena butuh sudo password).

## Masalah
Printer terhubung USB (`/dev/usb/lp1` ada sekarang), CUPS menerima job, tapi **`Sent 0 bytes`** — driver generik foomatic tidak kompatibel dengan Epson L3210 (EcoTank). Driver Epson resmi **belum terpasang**.

## Solusi — Install driver ESC/P-R Epson

```bash
# 1. Update & install driver Epson resmi (ESC/P-R untuk EcoTank L3210)
sudo apt update
sudo apt install -y epson-inkjet-printer-escpr

# (Kalau package tidak ketemu, tambahkan repo Epson dulu)
# sudo apt install -y lsb-release wget
# wget -qO epson.deb https://download.ebz.epson.net/dsc/f/03/00/15/42/31/0d1f5c2f2f2a2b1d/epson-inkjet-printer-escpr_1.7.20-1lsb3.2_amd64.deb
# sudo dpkg -i epson.deb && sudo apt -f install -y

# 2. Hapus printer lama yang pakai driver salah
sudo lpadmin -x L3210-Series

# 3. Re-add printer dengan driver Epson resmi
sudo lpadmin -p L3210-Series -E -v usb://EPSON/L3210%20Series?serial=583848533035373513\&interface=1 \
  -m 'lsb/usr/cupsfilters/epson-inkjet-printer-escpr/Epson-L3210_Series-epson-escpr-en.ppd' \
  -D 'Epson L3210-Series' -L 'KroomPrint'

# 4. Set default
sudo lpadmin -d L3210-Series

# 5. Restart CUPS & cek
sudo systemctl restart cups
lpstat -p L3210-Series
lpstat -d

# 6. Test print langsung
echo 'KROOMPRINT SETUP TEST OK' | lp -d L3210-Series
sleep 8
lpstat -o   # harus kosong = sudah tercetak
```

## Cara cek driver yang tersedia
```bash
lpinfo -m | grep -i epson | grep -i l3210   # harus ada L3210
```

## Verifikasi berhasil
```bash
lpstat -W completed -o L3210-Series   # job terakhir "completed" (bukan error)
cat /var/log/cups/page_log            # ada entri halaman (kalau diaktifkan)
```

---

## Setelah driver OK — KroomPrint LANGSUNG JALAN
Tidak perlu ubah kode KroomPrint. Job berikutnya dari web akan:
1. Dikirim via SSH `lp` ke CUPS pc-hitam
2. Driver Epson resmi render → kirim data ke USB → **PRINTER MENCETAK**
3. Poller KroomPrint mendeteksi `completed` → status 100%
