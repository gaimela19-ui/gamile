import jwt from 'jsonwebtoken';
import { signUserJwt } from './jwt.js';

export function getRefreshCookieOptions() {
  const allowCrossSite = ['1', 'true', 'yes', 'on'].includes(String(process.env.ALLOW_CROSS_SITE_COOKIES || '').toLowerCase());
  let cookieSameSite = (process.env.COOKIE_SAMESITE || (process.env.NODE_ENV === 'production' ? 'none' : 'lax')).toLowerCase();
  if (allowCrossSite) cookieSameSite = 'none';
  const sameSiteValue = ['lax', 'strict', 'none'].includes(cookieSameSite) ? cookieSameSite : 'lax';

  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: sameSiteValue,
    path: '/api/auth'
  };
}

export function shouldExposeRefreshToken(req) {
  const clientType = String(req.headers['x-client-type'] || '').toLowerCase();
  const clientPlatform = String(req.headers['x-client-platform'] || '').toLowerCase();
  return clientType === 'mobile-app' || clientPlatform === 'ios' || clientPlatform === 'android';
}

export function issueAuthTokens(req, res, userId, options = {}) {
  const accessExpiresIn = options.accessExpiresIn || process.env.ACCESS_TOKEN_TTL || '1h';
  const accessToken = signUserJwt(userId, { expiresIn: accessExpiresIn });
  const refreshTtlDays = parseInt(process.env.REFRESH_TOKEN_DAYS || '30', 10);
  const refreshTtlMs = refreshTtlDays * 24 * 60 * 60 * 1000;
  const refreshSecret = process.env.REFRESH_JWT_SECRET || process.env.JWT_SECRET;
  const refreshToken = jwt.sign({ sub: userId.toString(), type: 'refresh' }, refreshSecret, {
    expiresIn: `${refreshTtlDays}d`
  });

  res.cookie('rt', refreshToken, { ...getRefreshCookieOptions(), maxAge: refreshTtlMs });

  return {
    accessToken,
    refreshToken: shouldExposeRefreshToken(req) ? refreshToken : undefined,
    refreshTtlMs
  };
}