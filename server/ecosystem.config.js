module.exports = {
  apps: [
    {
      name: 'maozi-rps-server',
      script: 'dist/index.js',
      cwd: '/opt/maozi-rps/server',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 60205,
        JWT_SECRET: 'maozi-rps-secret-key-change-this',
      },
      error_file: '/var/log/maozi-rps/error.log',
      out_file: '/var/log/maozi-rps/output.log',
      time: true,
    },
  ],
};
