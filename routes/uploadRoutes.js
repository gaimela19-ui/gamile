import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import { upload, uploadProductImage } from '../controllers/uploadController.js';

const router = express.Router();

// Ensure robust CORS for uploads (browsers send preflight for multipart/form-data)
router.use((req, res, next) => {
	try {
		const origin = req.headers.origin;
		// Echo origin if present; fallback * for non-credentialed requests (no auth header)
		if (origin) {
			if (!res.getHeader('Access-Control-Allow-Origin')) {
				res.setHeader('Access-Control-Allow-Origin', origin);
			}
			res.setHeader('Access-Control-Allow-Credentials', 'true');
			const vary = res.getHeader('Vary');
			if (!vary) res.setHeader('Vary', 'Origin');
			else if (!String(vary).includes('Origin')) res.setHeader('Vary', vary + ', Origin');
		} else if (!res.getHeader('Access-Control-Allow-Origin')) {
			res.setHeader('Access-Control-Allow-Origin', '*');
		}
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Accept-Language, Authorization, X-Client-Type, X-Client-Platform, X-Refresh-Token');
		// Expose error details (optional)
		res.setHeader('Access-Control-Expose-Headers', 'X-App-Version');
		if (req.method === 'OPTIONS') {
			return res.sendStatus(204);
		}
	} catch (e) {
		console.warn('[uploads][cors] failed to set headers', e?.message || e);
	}
	next();
});

// Multer error catcher to ensure CORS headers still returned
router.use((err, req, res, next) => {
	if (!err) return next();
	try {
		const origin = req.headers.origin;
		if (origin && !res.getHeader('Access-Control-Allow-Origin')) {
			res.setHeader('Access-Control-Allow-Origin', origin);
			res.setHeader('Access-Control-Allow-Credentials', 'true');
		}
	} catch {}
	console.error('[uploads] middleware error', err?.message || err);
	res.status(400).json({ message: err?.message || 'Upload error' });
});

// POST /api/uploads/product-image
// Allow unauthenticated upload only when SKIP_DB=1 (local test mode) so we can verify CORS without JWT.
const allowUnauth = process.env.SKIP_DB === '1';
router.post('/product-image', allowUnauth ? upload.single('file') : [adminAuth, upload.single('file')], async (req, res, next) => {
	// Extra diagnostics to Cloud Run logs for persistent CORS/400 troubleshooting
	try {
		console.log('[upload][product-image] incoming', {
			origin: req.headers.origin,
			auth: !!req.headers.authorization,
			contentType: req.headers['content-type'],
			length: req.headers['content-length']
		});
	} catch {}
	try {
		await uploadProductImage(req, res);
	} catch (e) {
		console.error('[upload][product-image] handler error', e?.message || e);
		next(e);
	}
});

// GET helper (browsers hitting the URL directly with GET will otherwise 404 via global handler).
// Respond with 405 Method Not Allowed and usage instructions.
router.get('/product-image', (req, res) => {
	try {
		// CORS headers already set by router.use above; just return guidance
		res.status(405).json({
			message: 'Use POST multipart/form-data with field name "file" at this endpoint. Include Authorization if required.'
		});
	} catch (e) {
		res.status(405).json({ message: 'Use POST multipart/form-data with field name "file".' });
	}
});

// POST /api/uploads/announcement-icon  (stores in 'announcements/icons' folder)
router.post('/announcement-icon', adminAuth, upload.single('file'), (req, res, next) => {
	// Inject default folder for announcement icons
	req.body = { ...(req.body || {}), folder: 'announcements/icons' };
	next();
}, async (req, res, next) => {
	try {
		// Delegate to common handler; respond directly with its payload
		await uploadProductImage(req, res, next);
	} catch (e) {
		next(e);
	}
});

export default router;