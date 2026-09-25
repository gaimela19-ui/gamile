import FooterSettings from '../models/FooterSettings.js';
import FooterLink from '../models/FooterLink.js';
import { deepseekTranslate, isDeepseekConfigured } from '../services/translate/deepseek.js';

const mapToPlainObject = (mapLike) => {
  if (!mapLike) return undefined;
  if (mapLike instanceof Map) {
    return Object.fromEntries(mapLike.entries());
  }
  if (typeof mapLike === 'object') {
    return Object.fromEntries(Object.entries(mapLike));
  }
  return undefined;
};

const sanitizeLocalizationPayload = (value) => {
  if (!value || typeof value !== 'object') return undefined;
  const result = {};
  for (const [lang, text] of Object.entries(value)) {
    if (typeof text !== 'string') continue;
    const trimmed = text.trim();
    if (trimmed) {
      result[lang] = trimmed;
    }
  }
  return Object.keys(result).length ? result : {};
};

// Get footer settings
export const getFooterSettings = async (req, res) => {
  try {
  const reqLang = typeof req.query.lang === 'string' ? req.query.lang.trim() : '';
  const allowAuto = isDeepseekConfigured() && String(req.query.autoTranslate || 'false').toLowerCase() === 'true';
    let settings = await FooterSettings.findOne();
    if (!settings) {
      settings = await FooterSettings.create({});
    }
    const obj = settings.toObject({ depopulate: true, minimize: false });
    if (reqLang) {
      // description
      try {
        const d = obj.description_i18n?.[reqLang] || settings.description_i18n?.get?.(reqLang);
        if (d) obj.description = d;
        else if (allowAuto && obj.description) {
          try {
            const tr = await deepseekTranslate(obj.description, 'auto', reqLang);
            const map = new Map(settings.description_i18n || []);
            map.set(reqLang, tr);
            settings.description_i18n = map;
            obj.description = tr;
            await settings.save().catch(() => {});
          } catch {}
        }
      } catch {}
      // newsletter fields
      obj.newsletter = obj.newsletter || {};
      const nl = settings.newsletter || {};
      const localizeField = async (fieldKey) => {
        try {
          const val = obj.newsletter?.[fieldKey];
          const mapName = `${fieldKey}_i18n`;
          const existing = obj.newsletter?.[mapName]?.[reqLang] || nl?.[mapName]?.get?.(reqLang);
          if (existing) obj.newsletter[fieldKey] = existing;
          else if (allowAuto && val) {
            try {
              const tr = await deepseekTranslate(val, 'auto', reqLang);
              const currentMap = new Map(nl?.[mapName] || []);
              currentMap.set(reqLang, tr);
              nl[mapName] = currentMap;
              obj.newsletter[fieldKey] = tr;
            } catch {}
          }
        } catch {}
      };
      await localizeField('title');
      await localizeField('subtitle');
      await localizeField('placeholder');
      await localizeField('buttonText');
      // Persist newsletter maps if any were added
      try { settings.newsletter = nl; await settings.save().catch(() => {}); } catch {}
    }
    // Ensure map fields are returned as plain objects for admin UI consumption
    obj.description_i18n = mapToPlainObject(settings.description_i18n) || undefined;
    if (obj.newsletter) {
      ['title', 'subtitle', 'placeholder', 'buttonText'].forEach((key) => {
        const mapKey = `${key}_i18n`;
        if (settings.newsletter?.[mapKey]) {
          obj.newsletter[mapKey] = mapToPlainObject(settings.newsletter[mapKey]);
        }
      });
    }
    res.json(obj);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update footer settings
export const updateFooterSettings = async (req, res) => {
  try {
    let settings = await FooterSettings.findOne();
    if (!settings) {
      settings = new FooterSettings();
    }

    const payload = { ...req.body };
    if (Object.prototype.hasOwnProperty.call(req.body, 'description_i18n')) {
      const sanitized = sanitizeLocalizationPayload(req.body.description_i18n);
      payload.description_i18n = sanitized && Object.keys(sanitized).length ? sanitized : undefined;
    }

    Object.assign(settings, payload);
    await settings.save();
    
    // Broadcast real-time update for footer settings (non-fatal if broadcaster unavailable)
    try {
      const broadcast = req.app?.get?.('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({
          type: 'footer_settings_updated',
          data: settings
        });
      }
    } catch (e) {
      console.error('Failed to broadcast footer settings update:', e);
    }
    
    res.json(settings);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Get all footer links
export const getFooterLinks = async (req, res) => {
  try {
  const reqLang = typeof req.query.lang === 'string' ? req.query.lang.trim() : '';
  const allowAuto = isDeepseekConfigured() && String(req.query.autoTranslate || 'false').toLowerCase() === 'true';
    const links = await FooterLink.find().sort('order');
    if (reqLang) {
      for (const l of links) {
        try {
          const nm = l.name_i18n?.get?.(reqLang) || (l.name_i18n && l.name_i18n[reqLang]);
          if (nm) l.name = nm;
          else if (allowAuto && l.name) {
            try {
              const tr = await deepseekTranslate(l.name, 'auto', reqLang);
              const map = new Map(l.name_i18n || []);
              map.set(reqLang, tr);
              l.name_i18n = map;
              l.name = tr;
              await l.save().catch(() => {});
            } catch {}
          }
        } catch {}
      }
    }
    res.json(links);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create footer link
export const createFooterLink = async (req, res) => {
  try {
    const link = new FooterLink(req.body);
    const savedLink = await link.save();
    // Broadcast minimal update
    try {
      const broadcast = req.app?.get?.('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'footer_links_updated', data: { action: 'created', link: savedLink } });
      }
    } catch {}
    res.status(201).json(savedLink);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Update footer link
export const updateFooterLink = async (req, res) => {
  try {
    const link = await FooterLink.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!link) {
      return res.status(404).json({ message: 'Footer link not found' });
    }
    // Broadcast update
    try {
      const broadcast = req.app?.get?.('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'footer_links_updated', data: { action: 'updated', link } });
      }
    } catch {}
    res.json(link);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Delete footer link
export const deleteFooterLink = async (req, res) => {
  try {
    const link = await FooterLink.findByIdAndDelete(req.params.id);
    
    if (!link) {
      return res.status(404).json({ message: 'Footer link not found' });
    }
    // Broadcast delete
    try {
      const broadcast = req.app?.get?.('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'footer_links_updated', data: { action: 'deleted', id: req.params.id } });
      }
    } catch {}
    res.json({ message: 'Footer link deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Reorder footer links
export const reorderFooterLinks = async (req, res) => {
  try {
    const { links } = req.body;
    await Promise.all(
      links.map(({ id, order, section }) => 
        FooterLink.findByIdAndUpdate(id, { order, section })
      )
    );
    try {
      const broadcast = req.app?.get?.('broadcastToClients');
      if (typeof broadcast === 'function') {
        broadcast({ type: 'footer_links_updated', data: { action: 'reordered', links: links } });
      }
    } catch {}
    res.json({ message: 'Links reordered successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};