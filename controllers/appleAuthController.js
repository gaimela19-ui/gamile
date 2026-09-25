import User from '../models/User.js';
import Settings from '../models/Settings.js';
import { issueAuthTokens } from '../utils/authTokens.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getWelcomeCouponCode } from '../utils/welcomeCoupon.js';
import { normalizePhoneE164ish } from '../utils/phone.js';

const APPLE_ISSUER = 'https://appleid.apple.com';
const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

function buildAllowedAudiences(settings) {
  const extraAudiences = String(process.env.APPLE_EXTRA_AUDIENCES || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const raw = [
    settings?.appleAuth?.clientId,
    process.env.APPLE_CLIENT_ID,
    process.env.APPLE_WEB_CLIENT_ID,
    process.env.EXPO_APPLE_CLIENT_ID,
    'host.exp.Exponent',
    ...extraAudiences,
  ];
  return Array.from(new Set(raw.map((v) => String(v || '').trim()).filter(Boolean)));
}

function normalizeName(fullName) {
  if (!fullName || typeof fullName !== 'object') return '';
  const first = String(fullName.givenName || '').trim();
  const last = String(fullName.familyName || '').trim();
  return `${first} ${last}`.trim();
}

export const appleAuth = async (req, res) => {
  try {
    const identityToken = String(req.body?.identityToken || '').trim();
    const appleUserId = String(req.body?.user || '').trim();
    const fallbackEmail = String(req.body?.email || '').trim().toLowerCase();
    const fallbackName = normalizeName(req.body?.fullName) || 'Apple User';
    const normalizedPhoneNumber = typeof req.body?.phoneNumber === 'string'
      ? (normalizePhoneE164ish(req.body.phoneNumber, req.body?.region) || '')
      : '';

    if (!identityToken) {
      return res.status(400).json({ message: 'Missing Apple identity token' });
    }

    const settings = await Settings.findOne();
    const allowedAudiences = buildAllowedAudiences(settings);
    if (!allowedAudiences.length) {
      return res.status(500).json({ message: 'Apple auth is not configured' });
    }

    let verified;
    try {
      verified = await jwtVerify(identityToken, appleJwks, {
        issuer: APPLE_ISSUER
      });
    } catch {
      return res.status(401).json({ message: 'Invalid Apple token' });
    }

    const claims = verified?.payload || {};
    const tokenAudiences = Array.isArray(claims.aud)
      ? claims.aud.map((v) => String(v || '').trim()).filter(Boolean)
      : [String(claims.aud || '').trim()].filter(Boolean);
    const audienceOk = tokenAudiences.some((aud) => allowedAudiences.includes(aud));
    const skipAudienceCheck = ['1', 'true', 'yes', 'on'].includes(String(process.env.APPLE_SKIP_AUDIENCE_CHECK || '').toLowerCase());
    const nonProd = process.env.NODE_ENV !== 'production';
    if (!audienceOk) {
      if (skipAudienceCheck || nonProd) {
        console.warn('[appleAuth] audience mismatch bypassed', {
          tokenAudiences,
          allowedAudiences,
          nodeEnv: process.env.NODE_ENV || 'unknown',
          skipAudienceCheck,
        });
      } else {
      return res.status(401).json({
        message: 'Invalid Apple token audience',
        detail: `expected one of: ${allowedAudiences.join(', ')}`,
        got: tokenAudiences,
      });
      }
    }

    const resolvedAppleId = String(claims.sub || appleUserId || '').trim();
    if (!resolvedAppleId) {
      return res.status(400).json({ message: 'Apple account identifier missing' });
    }

    const tokenEmail = String(claims.email || '').trim().toLowerCase();
    const resolvedEmail = tokenEmail || fallbackEmail;

    let user = null;
    if (resolvedEmail) {
      user = await User.findOne({ $or: [{ appleId: resolvedAppleId }, { email: resolvedEmail }] });
    } else {
      user = await User.findOne({ appleId: resolvedAppleId });
    }

    let isNewUser = false;
    if (!user) {
      if (!resolvedEmail) {
        return res.status(400).json({ message: 'Apple account missing email. Please use Apple Sign In once with email sharing enabled.' });
      }
      user = new User({
        name: fallbackName,
        email: resolvedEmail,
        provider: 'apple',
        appleId: resolvedAppleId,
        phoneNumber: normalizedPhoneNumber || undefined,
        role: 'user',
        lastLoginAt: new Date()
      });
      await user.save();
      isNewUser = true;
    } else {
      let modified = false;
      if (!user.appleId) {
        user.appleId = resolvedAppleId;
        modified = true;
      }
      if (resolvedEmail && user.email !== resolvedEmail) {
        user.email = resolvedEmail;
        modified = true;
      }
      if (!user.name && fallbackName) {
        user.name = fallbackName;
        modified = true;
      }
      if (user.provider !== 'apple') {
        user.provider = 'apple';
        modified = true;
      }
      user.lastLoginAt = new Date();
      if (modified) await user.save();
      else await user.updateOne({ lastLoginAt: user.lastLoginAt });
    }

    const accessTtl = 60 * 60;
    const { accessToken, refreshToken } = issueAuthTokens(req, res, user._id, { accessExpiresIn: '1h' });

    const welcomeCouponCode = isNewUser ? await getWelcomeCouponCode() : '';
    const payload = {
      token: accessToken,
      expiresIn: accessTtl,
      requiresPhoneNumber: !!(isNewUser && !user.phoneNumber),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        image: user.image || null,
        provider: user.provider
      }
    };
    if (refreshToken) {
      payload.refreshToken = refreshToken;
    }
    if (welcomeCouponCode) {
      payload.welcomeCoupon = { code: welcomeCouponCode };
    }

    return res.json(payload);
  } catch (e) {
    console.error('Apple auth error:', e);
    return res.status(500).json({ message: 'Apple authentication failed' });
  }
};