// Simple in-process scheduler for ScheduledPush
import ScheduledPush from '../models/ScheduledPush.js';
import { broadcastAll, broadcastToAdmins, sendToUser } from '../controllers/mobilePushController.js';

let _timer = null;

export function startPushScheduler(app) {
  if (_timer) return;
  const tick = async () => {
    try {
      const now = new Date();
      // Fetch a small batch of due pushes
      const due = await ScheduledPush.find({ status: 'scheduled', scheduleAt: { $lte: now } }).sort({ scheduleAt: 1 }).limit(5);
      for (const job of due) {
        try {
          // Fake req/res objects to reuse controller logic without duplication
          const req = {
            body: {
              title: job.title,
              body: job.body,
              data: job.data,
              badge: job.badge,
              sound: job.sound,
              channelId: job?.audience?.channelId,
              userId: job?.audience?.userId,
              email: job?.audience?.email,
              imageUrl: job.imageUrl
            },
            user: { _id: job.createdBy }
          };
          const res = { json: () => {}, status: (c) => ({ json: () => {} }) };
          if (job.audience?.type === 'admins') await broadcastToAdmins(req, res);
          else if (job.audience?.type === 'user') await sendToUser(req, res);
          else await broadcastAll(req, res);
          job.status = 'sent';
          await job.save();
        } catch (e) {
          job.status = 'failed';
          job.result = { error: e?.message || String(e) };
          await job.save();
        }
      }
    } catch {}
  };
  _timer = setInterval(tick, 60 * 1000);
}

export function stopPushScheduler() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
