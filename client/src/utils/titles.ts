/**
 * 称号系统（前端版本）
 */
export interface TitleInfo {
  name: string;
  description: string;
  color: string;
  glow?: boolean;
}

const gameCountTitles: TitleInfo[] = [
  { name: '猜拳萌新', description: '初入拳坛的新手', color: '#9E9E9E' },
  { name: '初学者', description: '正在摸索门道', color: '#9E9E9E' },
  { name: '练习生', description: '每日苦练不辍', color: '#9E9E9E' },
  { name: '入门学徒', description: '掌握基本规则', color: '#FFFFFF' },
  { name: '拳坛新秀', description: '初露锋芒', color: '#FFFFFF' },
  { name: '出拳者', description: '敢于亮剑', color: '#FFFFFF' },
  { name: '石头学徒', description: '偏爱石头的坚定', color: '#FFFFFF' },
  { name: '剪刀行者', description: '剪刀出手如风', color: '#4CAF50' },
  { name: '布艺大师', description: '以柔克刚之道', color: '#4CAF50' },
  { name: '三修学徒', description: '三系兼修均衡发展', color: '#4CAF50' },
  { name: '对局常客', description: '拳场老面孔', color: '#4CAF50' },
  { name: '资深拳手', description: '身经百战', color: '#4CAF50' },
  { name: '拳坛老手', description: '经验丰富的高手', color: '#2196F3' },
  { name: '百胜将军', description: '已获百胜战绩', color: '#2196F3' },
  { name: '常胜将军', description: '胜多负少', color: '#2196F3' },
  { name: '猜拳达人', description: '人人皆知的高手', color: '#2196F3' },
  { name: '拳场明星', description: '聚光灯下的焦点', color: '#2196F3' },
  { name: '实力拳师', description: '实力得到认可', color: '#9C27B0' },
  { name: '不败传说', description: '极少尝败绩', color: '#9C27B0', glow: true },
  { name: '猜拳大师', description: '一代宗师风范', color: '#9C27B0', glow: true },
  { name: '传奇拳手', description: '拳坛传奇人物', color: '#9C27B0', glow: true },
  { name: '千场战神', description: '历经千场磨砺', color: '#9C27B0', glow: true },
  { name: '超凡入圣', description: '超越凡俗的境界', color: '#FFD700', glow: true },
  { name: '登峰造极', description: '技艺已达顶峰', color: '#FFD700', glow: true },
  { name: '拳霸天下', description: '天下无敌手', color: '#FFD700', glow: true },
  { name: '猜拳之王', description: '称霸拳坛的王者', color: '#FFD700', glow: true },
  { name: '猜拳宗师', description: '猜拳领域的至尊', color: '#FFD700', glow: true },
];

const winStreakTitles: [number, TitleInfo][] = [
  [3, { name: '三连胜挑战者', description: '初尝连胜滋味', color: '#9E9E9E' }],
  [5, { name: '连胜先锋', description: '连胜的气势', color: '#4CAF50' }],
  [8, { name: '势如破竹', description: '无人可挡', color: '#2196F3' }],
  [10, { name: '不败战神', description: '十连胜的荣耀', color: '#9C27B0', glow: true }],
  [15, { name: '拳坛霸主', description: '称霸一方的存在', color: '#9C27B0', glow: true }],
  [20, { name: '猜拳之神', description: '二十连胜神话', color: '#FFD700', glow: true }],
  [30, { name: '无敌传说', description: '天下无敌', color: '#FFD700', glow: true }],
  [50, { name: '传奇王者', description: '五十连胜传说', color: '#FF6F00', glow: true }],
  [100, { name: '绝世拳圣', description: '百连胜震古烁今', color: '#FF6F00', glow: true }],
];

export function getGameCountTitle(games: number): TitleInfo {
  if (games <= 0) return gameCountTitles[0];
  const index = Math.min(Math.floor((games - 1) / 200), gameCountTitles.length - 1);
  return gameCountTitles[index];
}

export function getWinStreakTitle(streak: number): TitleInfo | null {
  const match = winStreakTitles.findLast(([threshold]) => streak >= threshold);
  return match ? match[1] : null;
}
