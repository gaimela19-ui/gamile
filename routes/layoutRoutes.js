import express from 'express';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import PageLayout from '../models/PageLayout.js';
import { auth, adminAuth } from '../middleware/auth.js';

const router = express.Router();

// Simple file-based fallback for layout persistence when DB is unavailable (dev-friendly)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'pageLayout.json');

function ensureDataDir() {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

function readLayoutFromFile() {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.sections)) {
      return { sections: parsed.sections, sectionGap: typeof parsed.sectionGap === 'number' ? parsed.sectionGap : 6 };
    }
  } catch {}
  return null;
}

function writeLayoutToFile({ sections, sectionGap }) {
  try {
    ensureDataDir();
    const payload = { sections: Array.isArray(sections) ? sections : [], sectionGap: typeof sectionGap === 'number' ? sectionGap : 6, updatedAt: new Date().toISOString() };
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch {}
}

// Get current layout sections
router.get('/', async (req, res) => {
  try {
    // If DB isn't connected, short-circuit to file fallback to avoid 10s buffering timeout
    if (mongoose.connection.readyState !== 1) {
      const fileLayout = readLayoutFromFile();
      if (fileLayout) return res.json(fileLayout);
      // default empty state
      return res.json({ sections: [], sectionGap: 6 });
    }

    const doc = await PageLayout.getOrCreate();
    const payload = { sections: doc.sections, sectionGap: doc.sectionGap };
    // Mirror to file as redundancy
    writeLayoutToFile(payload);
    res.json(payload);
  } catch (error) {
    // On DB error, fallback to file
    const fileLayout = readLayoutFromFile();
    if (fileLayout) return res.json(fileLayout);
    res.status(500).json({ message: error.message });
  }
});

// Determine required guard for updates: admin-only by default in production, configurable via env
const requireAdminEnv = String(process.env.LAYOUT_UPDATE_REQUIRE_ADMIN ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false')).toLowerCase();
const REQUIRE_ADMIN = ['1','true','yes','on'].includes(requireAdminEnv);
// Dynamic guard: when DB is disconnected (e.g., SKIP_DB=1 dev mode), allow updates without DB auth
function dynamicUpdateGuard(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    // In production, still enforce admin auth even if DB is down
    if (process.env.NODE_ENV === 'production') {
      return adminAuth(req, res, next);
    }
    // Dev fallback: allow update to avoid data loss and enable file-based persistence
    return next();
  }
  return (REQUIRE_ADMIN ? adminAuth : auth)(req, res, next);
}

// Replace all sections (guarded)
router.put('/', dynamicUpdateGuard, async (req, res) => {
  try {
    const { sections, sectionGap } = req.body || {};
    if (!Array.isArray(sections)) {
      return res.status(400).json({ message: 'Invalid payload: sections must be an array' });
    }
    if (sectionGap !== undefined && (typeof sectionGap !== 'number' || sectionGap < 0 || sectionGap > 64)) {
      return res.status(400).json({ message: 'Invalid sectionGap' });
    }

    // If DB isn't connected, persist to file and return success to keep admin flow smooth
    if (mongoose.connection.readyState !== 1) {
      const payload = { sections, sectionGap: typeof sectionGap === 'number' ? sectionGap : 6 };
      writeLayoutToFile(payload);
      try {
        const broadcast = req.app.get('broadcastToClients');
        if (typeof broadcast === 'function') {
          broadcast({ type: 'layout_updated', data: payload });
        }
      } catch {}
      return res.json(payload);
    }

    const doc = await PageLayout.getOrCreate();
    doc.sections = sections;
    if (typeof sectionGap === 'number') doc.sectionGap = sectionGap;
    doc.markModified('sections');
    await doc.save();

    const payload = { sections: doc.sections, sectionGap: doc.sectionGap };
    // Mirror saved layout to file as redundancy
    writeLayoutToFile(payload);

    try {
      const broadcast = req.app.get('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'layout_updated', data: payload });
      }
    } catch {}

    res.json(payload);
  } catch (error) {
    // On error (e.g., DB timeout), still attempt to save to file to avoid data loss
    try {
      const { sections, sectionGap } = req.body || {};
      if (Array.isArray(sections)) {
        writeLayoutToFile({ sections, sectionGap: typeof sectionGap === 'number' ? sectionGap : 6 });
        return res.json({ sections, sectionGap: typeof sectionGap === 'number' ? sectionGap : 6 });
      }
    } catch {}
    res.status(500).json({ message: error.message });
  }
});

export default router;
