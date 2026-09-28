/**
 * SQLite 在线备份脚本：对运行中的数据库做一致性快照（WAL 安全）。
 *
 * 用法:
 *   node scripts/backup-db.mjs <数据库路径> <输出目录>
 * 示例:
 *   node scripts/backup-db.mjs /opt/maozi-rps/server/data/maozi-rps.db /opt/maozi-rps/backups
 *
 * crontab 示例（每天凌晨 3 点备份，保留最近 7 份）:
 *   0 3 * * * cd /opt/maozi-rps/server && node scripts/backup-db.mjs data/maozi-rps.db /opt/maozi-rps/backups >> /var/log/maozi-rps/backup.log 2>&1
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const [dbPath, outDir] = process.argv.slice(2);
if (!dbPath || !outDir) {
  console.error('用法: node scripts/backup-db.mjs <数据库路径> <输出目录>');
  process.exit(1);
}
if (!fs.existsSync(dbPath)) {
  console.error(`数据库不存在: ${dbPath}`);
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const tmpPath = path.join(outDir, `maozi-rps-${stamp}.db.tmp`);
const finalPath = path.join(outDir, `maozi-rps-${stamp}.db`);

try {
  const source = new Database(dbPath, { readonly: true });
  await source.backup(tmpPath);
  source.close();
  fs.renameSync(tmpPath, finalPath);

  // 清理过期备份：仅保留最近 7 份
  const files = fs
    .readdirSync(outDir)
    .filter((f) => /^maozi-rps-.*\.db$/.test(f))
    .sort()
    .reverse();
  for (const old of files.slice(7)) {
    fs.unlinkSync(path.join(outDir, old));
    console.log(`已删除过期备份: ${old}`);
  }
  const { size } = fs.statSync(finalPath);
  console.log(`备份完成: ${finalPath} (${(size / 1024).toFixed(1)} KB)`);
} catch (err) {
  console.error('备份失败:', err);
  try {
    fs.unlinkSync(tmpPath);
  } catch {}
  process.exit(1);
}
