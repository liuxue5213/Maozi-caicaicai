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
        DATABASE_PATH: '/opt/maozi-rps/server/data/maozi-rps.db',
        // JWT_SECRET 请通过环境变量或 .env 文件设置
        JWT_SECRET: process.env.JWT_SECRET || '',
        CORS_ORIGINS: 'http://120.48.13.152:60200,http://localhost:60200',
      },
      error_file: '/var/log/maozi-rps/error.log',
      out_file: '/var/log/maozi-rps/output.log',
      time: true,
    },
  ],
};
