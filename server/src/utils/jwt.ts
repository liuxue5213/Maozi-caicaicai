import jwt from 'jsonwebtoken';

// 生产环境强制要求设置 JWT_SECRET，否则启动失败
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = '30d';

if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[JWT] 错误：生产环境必须设置 JWT_SECRET 环境变量');
    process.exit(1);
  }
  console.warn('[JWT] 警告：未设置 JWT_SECRET，使用默认开发密钥（请勿用于生产）');
}

const SECRET = JWT_SECRET || 'dev-only-secret-do-not-use-in-production';

export interface JwtPayload {
  userId: string;
  username: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, SECRET) as JwtPayload;
  } catch {
    return null;
  }
}
