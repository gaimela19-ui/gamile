import webpush from 'web-push';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import PushSubscription from '../models/PushSubscription.js';
import { ApiError } from '../utils/ApiError.js';
import Settings from '../models/Settings.js';
import mongoose from 'mongoose';

// Helper duplicated (lightweight) – convert relative asset to absolute for notification icons
function toAbsolute(req, url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  try {
    const protoHeader = (req.headers['x-forwarded-proto'] || '').toString();
    const proto = protoHeader.split(',')[0] || req.protocol || 'http';
    const host = (req.headers['x-forwarded-host'] || req.get('host') || '').toString().split(',')[0];
    if (!host) return url;
    return `${proto}://${host}${url.startsWith('/') ? '' : '/'}${url}`;
  } catch { return url; }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:ebrahimzahalka123@gmail.com';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

export const getPublicKey = (req, res) => {
  if (!VAPID_PUBLIC) return res.status(500).json({ message: 'VAPID public key not set' });
  res.json({ publicKey: VAPID_PUBLIC });
};

export const saveSubscription = async (req, res, next) => {
  try {
    const sub = req.body;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      throw new ApiError(400, 'Invalid subscription payload');
    }

    const userId = req.user?._id || null;

    const updated = await PushSubscription.findOneAndUpdate(
      { endpoint: sub.endpoint },
      { ...sub, userId },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({ success: true, id: updated._id });
  } catch (err) {
    next(err);
  }
};

export const deleteSubscription = async (req, res, next) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) throw new ApiError(400, 'Endpoint required');
    await PushSubscription.deleteOne({ endpoint });
    res.json({ success: true });
  } catch (err) { next(err); }
};

export const sendTestNotification = async (req, res, next) => {
  try {
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) throw new ApiError(500, 'VAPID keys not configured');

    const subs = await PushSubscription.find(userFilter(req));
    // Resolve favicon from settings (fallback to default)
    let favicon = '/favicon.svg';
    try {
      const s = await Settings.findOne().select('favicon');
      if (s && s.favicon) favicon = toAbsolute(req, s.favicon);
    } catch {}
    const payload = JSON.stringify({
      title: 'Store notification',
      body: 'This is a loud test with sound and vibration (if supported).',
      icon: favicon,
      badge: favicon,
      url: '/',
      silent: false,
      requireInteraction: true,
      renotify: true,
      tag: 'store-push',
      vibrate: [200, 100, 200],
      playSound: true
    });

    const results = await Promise.allSettled(subs.map(s => webpush.sendNotification(s, payload)));

    // Clean up gone subs
    const toDelete = [];
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const code = r.reason?.statusCode;
        if (code === 404 || code === 410) {
          toDelete.push(subs[i].endpoint);
        }
      }
    });
    if (toDelete.length) await PushSubscription.deleteMany({ endpoint: { $in: toDelete } });

    res.json({ success: true, sent: subs.length, removed: toDelete.length });
  } catch (err) { next(err); }
};

function userFilter(req){
  // If authenticated, prefer only this user's subs. Admin can pass all=true to broadcast.
  if (req.user && !('all' in req.query)) return { userId: req.user._id };
  return {};
}

// Diagnostics: list current authenticated user's push subscriptions (or all if admin & all=true)
export const listSubscriptions = async (req, res, next) => {
  try {
    const filter = userFilter(req);
    // If admin requests all subs explicitly
    if (req.user?.role === 'admin' && req.query.all === 'true') {
      const subs = await PushSubscription.find().select('-__v');
      return res.json({ total: subs.length, subs });
    }
    const subs = await PushSubscription.find(filter).select('-__v');
    res.json({ total: subs.length, subs });
  } catch (e) { next(e); }
};
