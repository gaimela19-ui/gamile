import jwt from 'jsonwebtoken';

export function signUserJwt(userId, options = {}) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return jwt.sign({ userId }, secret, { expiresIn: '7d', ...options });
}

export function verifyJwt(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}
