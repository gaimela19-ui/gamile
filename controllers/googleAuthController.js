import { OAuth2Client } from 'google-auth-library';
import User from '../models/User.js';
import { issueAuthTokens } from '../utils/authTokens.js';
import { getWelcomeCouponCode } from '../utils/welcomeCoupon.js';
import Settings from '../models/Settings.js';
import { normalizePhoneE164ish } from '../utils/phone.js';

const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID ||
  process.env.GOOGLE_EXPO_CLIENT_ID ||
  process.env.GOOGLE_ANDROID_CLIENT_ID ||
  process.env.GOOGLE_IOS_CLIENT_ID ||
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ||
  process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID ||
  process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ||
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
);

function buildAllowedGoogleAudiences(settings) {
  const extraAudiences = String(process.env.GOOGLE_EXTRA_AUDIENCES || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const raw = [
    settings?.googleAuth?.clientId,
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_EXPO_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID,
    process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID,
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    ...extraAudiences,
  ];
  return Array.from(new Set(raw.map((v) => String(v || '').trim()).filter(Boolean)));
}


// POST /api/auth/google
// Body: { credential: string } from Google Identity Services one-tap / button
export const googleAuth = async (req, res) => {
  try {
    const { credential, phoneNumber, region } = req.body || {};
    if (!credential) {
      return res.status(400).json({ message: 'Missing Google credential' });
    }
    const normalizedPhoneNumber = typeof phoneNumber === 'string'
      ? (normalizePhoneE164ish(phoneNumber, region) || '')
      : '';

    const settings = await Settings.findOne();
    const allowedAudiences = buildAllowedGoogleAudiences(settings);
    if (!allowedAudiences.length) {
      return res.status(500).json({ message: 'Google auth is not configured' });
    }

    // Verify token with Google
    let ticket;
    try {
      ticket = await client.verifyIdToken({
        idToken: credential,
        audience: allowedAudiences
      });
    } catch (verifyError) {
      return res.status(401).json({
        message: 'Invalid Google token',
        detail: verifyError?.message || 'Token verification failed',
        allowedAudiences,
      });
    }

    const googlePayload = ticket.getPayload();
    if (!googlePayload) {
      return res.status(401).json({ message: 'Invalid Google token' });
    }

    const googleId = googlePayload.sub;
    const email = (googlePayload.email || '').toLowerCase();
    const name = googlePayload.name || googlePayload.given_name || 'User';
    const picture = googlePayload.picture;

    if (!email) {
      return res.status(400).json({ message: 'Google account missing email (possibly unverified)' });
    }

    let user = await User.findOne({ $or: [ { googleId }, { email } ] });
    let isNewUser = false;

    if (!user) {
      // Create new OAuth user (no password)
      user = new User({
        name,
        email,
        provider: 'google',
        googleId,
        phoneNumber: normalizedPhoneNumber || undefined,
        image: picture,
        role: 'user',
        lastLoginAt: new Date()
      });
      await user.save();
      isNewUser = true;
    } else {
      // Update any changed profile info & google linkage
      let modified = false;
      if (!user.googleId) { user.googleId = googleId; modified = true; }
      if (picture && picture !== user.image) { user.image = picture; modified = true; }
      if (user.provider !== 'google') { user.provider = 'google'; modified = true; }
      user.lastLoginAt = new Date();
      if (modified) await user.save(); else await user.updateOne({ lastLoginAt: user.lastLoginAt });
    }

    // Access token (short-lived) and refresh token (longer-lived) for persistence
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
  } catch (error) {
    console.error('Google auth error:', error);
    return res.status(500).json({ message: 'Google authentication failed' });
  }
};
