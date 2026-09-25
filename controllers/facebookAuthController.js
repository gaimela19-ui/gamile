import User from '../models/User.js';
import Settings from '../models/Settings.js';
import { issueAuthTokens } from '../utils/authTokens.js';
import { getWelcomeCouponCode } from '../utils/welcomeCoupon.js';

// POST /api/auth/facebook
// Body: { accessToken } obtained via Facebook JS SDK or mobile SDK
export const facebookAuth = async (req, res) => {
  try {
    const accessToken = req.body?.accessToken;
    if (!accessToken) {
      return res.status(400).json({ message: 'Missing accessToken' });
    }

    // Optionally verify against app via debug_token when app secret is configured
    let fbProfile = null;
    try {
      const settings = await Settings.findOne();
      const appId = settings?.facebookAuth?.appId || process.env.FACEBOOK_APP_ID || '';
      const appSecret = settings?.facebookAuth?.appSecret || process.env.FACEBOOK_APP_SECRET || '';
      // Prefer debug_token if app credentials exist; otherwise fall back to /me fields read
      if (appId && appSecret) {
        const appAccessToken = `${appId}|${appSecret}`;
        const debugResp = await fetch(`https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appAccessToken)}`, { method: 'GET' });
        const debugData = await debugResp.json();
        if (!debugResp.ok || !debugData?.data?.is_valid) {
          return res.status(401).json({ message: 'Invalid Facebook token' });
        }
      }
      // Fetch user profile
      const fields = 'id,name,email,picture.type(large)';
      const meResp = await fetch(`https://graph.facebook.com/me?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`, { method: 'GET' });
      const meData = await meResp.json();
      if (!meResp.ok || !meData?.id) {
        return res.status(401).json({ message: 'Failed to fetch Facebook profile' });
      }
      fbProfile = meData;
    } catch (err) {
      console.error('Facebook graph error:', err);
      return res.status(500).json({ message: 'Facebook verification failed' });
    }

    const facebookId = String(fbProfile.id);
    const email = (fbProfile.email || '').toLowerCase();
    const name = fbProfile.name || 'Facebook User';
    const picture = fbProfile?.picture?.data?.url || '';

    if (!email) {
      // Some FB accounts may not return email if not granted; allow account creation with placeholder
      // but better to require email for store flows. Here we enforce email presence.
      return res.status(400).json({ message: 'Facebook account missing email permission' });
    }

    let user = await User.findOne({ $or: [ { facebookId }, { email } ] });
    let isNewUser = false;
    if (!user) {
      user = new User({
        name,
        email,
        provider: 'facebook',
        facebookId,
        image: picture || undefined,
        role: 'user',
        lastLoginAt: new Date()
      });
      await user.save();
      isNewUser = true;
    } else {
      let modified = false;
      if (!user.facebookId) { user.facebookId = facebookId; modified = true; }
      if (picture && picture !== user.image) { user.image = picture; modified = true; }
      if (user.provider !== 'facebook') { user.provider = 'facebook'; modified = true; }
      user.lastLoginAt = new Date();
      if (modified) await user.save(); else await user.updateOne({ lastLoginAt: user.lastLoginAt });
    }

    // Issue tokens similar to authController/googleAuth
    const accessTtl = 60 * 60;
    const { accessToken: sessionToken, refreshToken } = issueAuthTokens(req, res, user._id, { accessExpiresIn: '1h' });

    const welcomeCouponCode = isNewUser ? await getWelcomeCouponCode() : '';
    const payload = {
      token: sessionToken,
      expiresIn: accessTtl,
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
    console.error('Facebook auth error:', e);
    return res.status(500).json({ message: 'Facebook authentication failed' });
  }
};
