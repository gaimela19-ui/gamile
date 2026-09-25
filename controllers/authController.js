import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import User from '../models/User.js';
// Note: legacy in-memory refreshTokenStore is not suitable for production (restarts/scale);
// we now issue signed JWT refresh tokens stored in HttpOnly cookies.
// revokeUserTokens kept for compatibility when ROTATE_ON_REFRESH is used elsewhere.
import { revokeUserTokens, consumeRefreshToken } from '../utils/refreshTokenStore.js';
import { getRefreshCookieOptions, issueAuthTokens } from '../utils/authTokens.js';
import { normalizePhoneE164ish } from '../utils/phone.js';
import { getWelcomeCouponCode } from '../utils/welcomeCoupon.js';

export const promoteToAdmin = async (req, res) => {
  try {
    const { email, secret } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!normalizedEmail) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Allow promotion if:
    // 1) No admin exists yet (bootstrap scenario), OR
    // 2) A valid secret token is provided matching ADMIN_SETUP_TOKEN
    const hasAdmin = await User.exists({ role: 'admin' });
    const configuredSecret = process.env.ADMIN_SETUP_TOKEN || '';
    const secretOk = configuredSecret && secret && String(secret) === String(configuredSecret);

    if (!secretOk && hasAdmin) {
      return res.status(403).json({ message: 'Admin already exists. Provide valid secret to promote.' });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.role = 'admin';
    await user.save();
  return res.json({ ok: true, id: user._id, email: user.email, role: user.role, image: user.image || null, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt });
  } catch (e) {
    console.error('promoteToAdmin error:', e);
    return res.status(500).json({ message: 'Failed to promote user' });
  }
};

export const register = async (req, res) => {
  try {
    const { name, email, password, phoneNumber, region } = req.body || {};
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const passwordValue = typeof password === 'string' ? password : '';
    const phoneValue = typeof phoneNumber === 'string' ? phoneNumber : undefined;

    if (!trimmedName) {
      return res.status(400).json({ message: 'Name is required' });
    }

    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!normalizedEmail || !emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ message: 'Please provide a valid email' });
    }

    if (!passwordValue || passwordValue.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Create new user
    const user = new User({
      name: trimmedName,
      email: normalizedEmail,
      password: passwordValue,
      phoneNumber: phoneValue ? (normalizePhoneE164ish(phoneValue, region) || undefined) : undefined,
      role: 'user' // Default role
    });

    await user.save();

    // Generate token
    const { accessToken, refreshToken } = issueAuthTokens(req, res, user._id);

    const welcomeCouponCode = await getWelcomeCouponCode();
    const payload = {
      token: accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        image: user.image || null,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt
      }
    };
    if (refreshToken) {
      payload.refreshToken = refreshToken;
    }
    if (welcomeCouponCode) {
      payload.welcomeCoupon = { code: welcomeCouponCode };
    }

    // Send response
    res.status(201).json(payload);
  } catch (error) {
    if (error?.code === 11000) {
      const duplicateField = Object.keys(error?.keyPattern || {})[0] || 'email';
      const fieldLabel = duplicateField === 'phoneNumber' ? 'phone number' : 'email';
      return res.status(400).json({ message: `User already exists with this ${fieldLabel}` });
    }
    if (error?.name === 'ValidationError') {
      const messages = Object.values(error.errors || {}).map((err) => err?.message).filter(Boolean);
      return res.status(400).json({ message: messages[0] || 'Invalid registration data' });
    }
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
};

export const login = async (req, res) => {
  try {
  const { email, password } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();
    
    // Find user
  const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      // Optional auto-register-on-login feature (disabled by default)
      const autoRegister = String(process.env.AUTO_REGISTER_ON_LOGIN || '').toLowerCase();
      const enabled = ['1','true','yes','on'].includes(autoRegister);
      if (!enabled) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }
      // Basic minimum validation before implicit registration
      if (!password || String(password).length < 6) {
        return res.status(400).json({ message: 'Password too short for automatic registration' });
      }
      try {
        const newUser = new User({
          name: normalizedEmail.split('@')[0],
          email: normalizedEmail,
          password,
          role: 'user',
          provider: 'local'
        });
        await newUser.save();
        const { accessToken, refreshToken } = issueAuthTokens(req, res, newUser._id);
        return res.status(201).json({
          autoRegistered: true,
          token: accessToken,
          ...(refreshToken ? { refreshToken } : {}),
          user: {
            id: newUser._id,
            name: newUser.name,
            email: newUser.email,
            role: newUser.role,
            image: newUser.image || null,
            createdAt: newUser.createdAt,
            lastLoginAt: newUser.lastLoginAt
          }
        });
      } catch (e) {
        console.error('Auto-register on login failed:', e);
        return res.status(500).json({ message: 'Failed to auto-register user' });
      }
    }

    // Check password (also try a trimmed variant to cover accidental spaces)
    const pwdInput = String(password || '');
    const pwdTrimmed = pwdInput.trim();
    let isMatch = await bcrypt.compare(pwdInput, user.password);
    if (!isMatch && pwdTrimmed !== pwdInput) {
      isMatch = await bcrypt.compare(pwdTrimmed, user.password);
    }
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate token
    const { accessToken, refreshToken } = issueAuthTokens(req, res, user._id);

    // Send response
    res.json({
      token: accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        image: user.image || null,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
};

export const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      image: user.image || null,
      phoneNumber: user.phoneNumber || '',
      addressLine1: user.addressLine1 || '',
      addressLine2: user.addressLine2 || '',
      city: user.city || '',
      state: user.state || '',
      postalCode: user.postalCode || '',
      country: user.country || '',
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const isAdmin = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('email role');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.json({ isAdmin: user.role === 'admin', email: user.email, role: user.role });
  } catch (e) {
    return res.status(500).json({ message: 'Failed to check admin status' });
  }
};

// POST /api/auth/refresh - rotate refresh token and issue new access
export const refresh = async (req, res) => {
  try {
    if (['1','true','yes','on'].includes(String(process.env.DISABLE_REFRESH_FLOW || '').toLowerCase())) {
      return res.status(400).json({ message: 'Refresh flow disabled' });
    }
    const headerRefreshToken = req.headers['x-refresh-token'];
    const rt = req.cookies?.rt || (Array.isArray(headerRefreshToken) ? headerRefreshToken[0] : headerRefreshToken) || req.body?.refreshToken;
    if (!rt) {
      console.warn('[auth][refresh] 401 missing_cookie origin=', req.headers.origin);
      return res.status(401).json({ message: 'Missing refresh token' });
    }
    // Verify stateless refresh JWT
    let userId;
    try {
      const refreshSecret = process.env.REFRESH_JWT_SECRET || process.env.JWT_SECRET;
      const payload = jwt.verify(rt, refreshSecret);
      if (payload?.type !== 'refresh') throw new Error('invalid_type');
      userId = payload.sub || payload.userId || payload.id;
    } catch (e) {
      // Backward-compat: accept legacy random tokens from in-memory store (until they naturally expire)
      const legacy = consumeRefreshToken(rt);
      if (!legacy) {
        console.warn('[auth][refresh] 401 jwt_invalid_or_expired origin=', req.headers.origin, ' err=', e?.message || e);
        return res.status(401).json({ message: 'Invalid or expired refresh token' });
      }
      userId = legacy.userId;
    }
    const user = await User.findById(userId);
    if (!user) {
      console.warn('[auth][refresh] 401 user_not_found userId=', userId);
      return res.status(401).json({ message: 'User no longer exists' });
    }
    // rotate: revoke user's old tokens if ROTATE_ON_REFRESH=1
    if (process.env.ROTATE_ON_REFRESH === '1') {
      try { revokeUserTokens(user._id.toString()); } catch {}
    }
    const { accessToken, refreshToken } = issueAuthTokens(req, res, user._id);
    return res.json({ token: accessToken, ...(refreshToken ? { refreshToken } : {}), user: { id: user._id, name: user.name, email: user.email, role: user.role, image: user.image || null, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt } });
  } catch (e) {
    console.error('Refresh error:', e);
    return res.status(500).json({ message: 'Failed to refresh session' });
  }
};

// POST /api/auth/logout - clear cookie and revoke tokens
export const logout = async (req, res) => {
  try {
    const rt = req.cookies?.rt;
    if (rt) {
      revokeUserTokens(req.user?._id?.toString() || '');
      res.clearCookie('rt', getRefreshCookieOptions());
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.json({ ok: true });
  }
};

// POST /api/auth/check-identifier { identifier }
// Checks whether an email or phone number already exists. Returns { exists: boolean, type: 'email'|'phone'|'unknown' }
export const checkIdentifier = async (req, res) => {
  try {
    const raw = String(req.body?.identifier || '').trim();
    const region = String(req.body?.region || '').trim() || undefined;
    if (!raw) return res.status(400).json({ message: 'identifier is required' });
    const emailRegex = /^\S+@\S+\.\S+$/;
    const phoneRegex = /^\+?[1-9]\d{6,15}$/; // simple E.164ish
    let type = 'unknown';
    let exists = false;
    if (emailRegex.test(raw)) {
      type = 'email';
      const user = await User.findOne({ email: raw.toLowerCase() }).select('_id');
      exists = !!user;
    } else if (phoneRegex.test(raw)) {
      type = 'phone';
      const normalized = normalizePhoneE164ish(raw, region);
      const user = await User.findOne({ phoneNumber: normalized }).select('_id');
      exists = !!user;
    } else {
      // Try coercing to phone digits and re-check
      const digits = normalizePhoneE164ish(raw, region);
      if (phoneRegex.test(digits)) {
        type = 'phone';
        const user = await User.findOne({ phoneNumber: digits }).select('_id');
        exists = !!user;
      }
    }
    return res.json({ exists, type });
  } catch (e) {
    return res.status(500).json({ message: 'Check failed' });
  }
};