module.exports = {
  apps: [
    {
      name: 'kroomprint-api',
      cwd: '/mnt/web/Nouvem/printer-wireless/backend',
      script: './kroomprint-backend',
      env: {
        KROOM_ADDR: ':8088',
        // SQLite must live on amba's local disk: WAL/mmap over the NAS network
        // mount caused fatal faults and repeated PM2 restarts.
        KROOM_DB: '/home/amba/kroomprint-data/kroomprint.db',
        KROOM_UPLOADS: '/mnt/web/Nouvem/printer-wireless/backend/uploads',
        // Without a locale the spawned CUPS filter chain silently emits zero
        // bytes ("Sent 0 bytes") while CUPS still reports the job completed.
        LANG: 'en_US.UTF-8',
        LANGUAGE: 'en_US:en',
        LC_ALL: 'C.UTF-8',
        KROOM_CUPS_URL: 'http://localhost:631',
        KROOM_CUPS_SSH: 'amba',
        KROOM_ORIGINS: 'http://100.90.80.85:5174,http://localhost:5174,http://127.0.0.1:5174,http://100.90.80.85:8088,http://localhost:8088',
        KROOM_DEMO: '0'
      },
      max_restarts: 10,
      restart_delay: 3000
    },
    {
      name: 'kroomprint-web',
      cwd: '/mnt/web/Nouvem/printer-wireless',
      script: 'node',
      args: 'server.cjs',
      env: {
        PORT: '5174',
        NODE_ENV: 'production'
      },
      max_restarts: 10,
      restart_delay: 3000
    }
  ]
};
