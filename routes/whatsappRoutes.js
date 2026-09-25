import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import { singleLink, bulkLinksByIds, bulkLinksByFilter } from '../controllers/whatsappController.js';
import WhatsAppAudit from '../models/WhatsAppAudit.js';

const router = express.Router();

// Generate a single WhatsApp chat link
router.post('/link', adminAuth, singleLink);
// Generate links for selected customer IDs
router.post('/links/ids', adminAuth, bulkLinksByIds);
// Generate links for all (optionally limited) filtered users
router.post('/links/filter', adminAuth, bulkLinksByFilter);

export default router;

// List audits (simple)
router.get('/audits', adminAuth, async (req, res) => {
	try {
		const limit = Math.min(parseInt(req.query.limit) || 50, 200);
		const audits = await WhatsAppAudit.find().sort({ createdAt: -1 }).limit(limit).select('-messageHash').lean();
		res.json({ audits });
	} catch (e) {
		res.status(500).json({ message: 'Failed to load audits' });
	}
});
