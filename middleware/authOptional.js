// Optional auth middleware: attaches user if Authorization header valid, otherwise continues.
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export async function protectOptional(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) {
      const token = auth.substring(7);
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'changeme');
        // Tokens are signed with { userId }, not { id }
        const uid = decoded?.userId || decoded?.id;
        if (uid) {
          const user = await User.findById(uid).select('_id role');
          if (user) req.user = user;
        }
      } catch {}
    }
  } catch {}
  next();
}

export default protectOptional;