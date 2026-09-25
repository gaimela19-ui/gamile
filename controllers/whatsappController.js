import { ApiError } from '../utils/ApiError.js';
import { buildWhatsAppLink, buildLinksForUsers, buildLinksByFilter } from '../services/whatsappService.js';

export const singleLink = async (req, res, next) => {
  try {
    const { phoneNumber, message } = req.body;
    if (!phoneNumber) throw new ApiError(400, 'phoneNumber required');
    const url = buildWhatsAppLink(phoneNumber, message || '');
    res.json({ success: true, url });
  } catch (e) { next(e); }
};

export const bulkLinksByIds = async (req, res, next) => {
  try {
    const { userIds, message, onlyOptIn } = req.body;
  const result = await buildLinksForUsers({ userIds, message, onlyOptIn: onlyOptIn !== false, adminId: req.user?._id });
    res.json({ success: true, ...result });
  } catch (e) { next(e); }
};

export const bulkLinksByFilter = async (req, res, next) => {
  try {
    const { message, onlyOptIn, limit } = req.body;
  const result = await buildLinksByFilter({ message, onlyOptIn: onlyOptIn !== false, limit, adminId: req.user?._id });
    res.json({ success: true, ...result });
  } catch (e) { next(e); }
};
