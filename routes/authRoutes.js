import express from 'express';
import { login, register, getCurrentUser, promoteToAdmin, isAdmin, refresh, logout, checkIdentifier } from '../controllers/authController.js';
import { googleAuth } from '../controllers/googleAuthController.js';
import { facebookAuth } from '../controllers/facebookAuthController.js';
import { appleAuth } from '../controllers/appleAuthController.js';
import Settings from '../models/Settings.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', login);
router.post('/register', register);
router.post('/check-identifier', checkIdentifier);
// Google OAuth (One-Tap / Button) - expects { credential }
router.post('/google', googleAuth);
router.post('/facebook', facebookAuth);
router.post('/apple', appleAuth);
router.post('/refresh', refresh);
router.post('/logout', auth, logout);
// Public auth config (currently only Google)
router.get('/config', async (req, res) => {
	try {
		const settings = await Settings.findOne();
		const googleClientId = (settings?.googleAuth?.clientId || process.env.GOOGLE_CLIENT_ID || '').trim();
		const googleExpoClientId = String(process.env.GOOGLE_EXPO_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_EXPO_CLIENT_ID || '').trim();
		const googleIosClientId = String(process.env.GOOGLE_IOS_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '').trim();
		const googleAndroidClientId = String(process.env.GOOGLE_ANDROID_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '').trim();
		const googleEnabled = !!(
			settings?.googleAuth?.enabled ||
			googleClientId ||
			googleExpoClientId ||
			googleIosClientId ||
			googleAndroidClientId
		);
		const facebookAuth = settings?.facebookAuth || { enabled: false, appId: '' };
		const appleClientId = (settings?.appleAuth?.clientId || process.env.APPLE_CLIENT_ID || '').trim();
		const appleEnabled = !!(settings?.appleAuth?.enabled || appleClientId);
		res.json({
			google: {
				enabled: !!googleEnabled,
				clientId: googleClientId,
				expoClientId: googleExpoClientId,
				iosClientId: googleIosClientId,
				androidClientId: googleAndroidClientId,
			},
			facebook: { enabled: !!facebookAuth.enabled, appId: facebookAuth.appId || '' },
			apple: { enabled: !!appleEnabled, clientId: appleClientId }
		});
	} catch (e) {
		res.status(500).json({ message: 'Failed to load auth config' });
	}
});
router.get('/me', auth, getCurrentUser);
router.get('/is-admin', auth, isAdmin);
// Bootstrap/recovery: promote a user to admin.
// Requires ADMIN_SETUP_TOKEN env or absence of existing admin users.
router.post('/promote', promoteToAdmin);

export default router;