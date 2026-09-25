import Attribute from '../models/Attribute.js';
import AttributeValue from '../models/AttributeValue.js';

export const listAttributes = async (req, res) => {
  try {
    const lang = typeof req.query.lang === 'string' ? req.query.lang.trim() : '';
    const items = await Attribute.find().sort({ order: 1, name: 1 }).lean();
    if (lang) {
      for (const it of items) {
        const nm = (it?.name_i18n && (typeof it.name_i18n.get === 'function' ? it.name_i18n.get(lang) : it.name_i18n[lang])) || '';
        if (nm) it.name = nm;
        if (it.name_i18n) delete it.name_i18n;
        const desc = (it?.description_i18n && (typeof it.description_i18n.get === 'function' ? it.description_i18n.get(lang) : it.description_i18n[lang])) || '';
        if (desc) it.description = desc;
        if (it.description_i18n) delete it.description_i18n;
      }
    }
    res.json(items);
  } catch (e) {
    res.status(500).json({ message: 'Failed to load attributes' });
  }
};

export const getAttribute = async (req, res) => {
  try {
    const lang = typeof req.query.lang === 'string' ? req.query.lang.trim() : '';
    const item = await Attribute.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ message: 'Attribute not found' });
    if (lang) {
      const nm = (item?.name_i18n && (typeof item.name_i18n.get === 'function' ? item.name_i18n.get(lang) : item.name_i18n[lang])) || '';
      if (nm) item.name = nm;
      if (item.name_i18n) delete item.name_i18n;
      const desc = (item?.description_i18n && (typeof item.description_i18n.get === 'function' ? item.description_i18n.get(lang) : item.description_i18n[lang])) || '';
      if (desc) item.description = desc;
      if (item.description_i18n) delete item.description_i18n;
    }
    res.json(item);
  } catch (e) {
    res.status(500).json({ message: 'Failed to load attribute' });
  }
};

export const createAttribute = async (req, res) => {
  try {
    const { name, type, description, allowMultiple, required, order, slug } = req.body;
    const exists = await Attribute.findOne({ name: new RegExp(`^${String(name).trim()}$`, 'i') });
    if (exists) return res.status(400).json({ message: 'Attribute with this name already exists' });
    const attr = new Attribute({ name, type, description, allowMultiple, required, order, slug });
    const saved = await attr.save();
    res.status(201).json(saved);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to create attribute' });
  }
};

export const updateAttribute = async (req, res) => {
  try {
    const { name, type, description, allowMultiple, required, order, slug } = req.body || {};
    const item = await Attribute.findByIdAndUpdate(
      req.params.id,
      { name, type, description, allowMultiple, required, order, slug },
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ message: 'Attribute not found' });
    res.json(item);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to update attribute' });
  }
};

export const deleteAttribute = async (req, res) => {
  try {
    const id = req.params.id;
    const item = await Attribute.findByIdAndDelete(id);
    if (!item) return res.status(404).json({ message: 'Attribute not found' });
    await AttributeValue.deleteMany({ attribute: id });
    res.json({ message: 'Deleted', id });
  } catch (e) {
    res.status(500).json({ message: 'Failed to delete attribute' });
  }
};

// Values
export const listValues = async (req, res) => {
  try {
    const { attributeId } = req.params;
    const lang = typeof req.query.lang === 'string' ? req.query.lang.trim() : '';
    const values = await AttributeValue.find({ attribute: attributeId }).sort({ order: 1, value: 1 }).lean();
    if (lang) {
      for (const v of values) {
        const val = (v?.value_i18n && (typeof v.value_i18n.get === 'function' ? v.value_i18n.get(lang) : v.value_i18n[lang])) || '';
        if (val) v.value = val;
        if (v.value_i18n) delete v.value_i18n;
      }
    }
    res.json(values);
  } catch (e) {
    res.status(500).json({ message: 'Failed to load values' });
  }
};

export const createValue = async (req, res) => {
  try {
    const { attributeId } = req.params;
    const { value, meta, order, slug, isActive } = req.body;
    const exists = await AttributeValue.findOne({ attribute: attributeId, value: new RegExp(`^${String(value).trim()}$`, 'i') });
    if (exists) return res.status(400).json({ message: 'Value already exists for this attribute' });
    const v = new AttributeValue({ attribute: attributeId, value, meta, order, slug, isActive });
    const saved = await v.save();
    res.status(201).json(saved);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to create value' });
  }
};

export const updateValue = async (req, res) => {
  try {
    const { id } = req.params; // value id
    const { value, meta, order, slug, isActive } = req.body || {};
    const updated = await AttributeValue.findByIdAndUpdate(id, { value, meta, order, slug, isActive }, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ message: 'Value not found' });
    res.json(updated);
  } catch (e) {
    res.status(400).json({ message: e.message || 'Failed to update value' });
  }
};

export const deleteValue = async (req, res) => {
  try {
    const { id } = req.params;
    const removed = await AttributeValue.findByIdAndDelete(id);
    if (!removed) return res.status(404).json({ message: 'Value not found' });
    res.json({ message: 'Deleted', id });
  } catch (e) {
    res.status(500).json({ message: 'Failed to delete value' });
  }
};

// i18n endpoints
export const getAttributeI18n = async (req, res) => {
  try {
    const doc = await Attribute.findById(req.params.id).select('name_i18n description_i18n').lean();
    if (!doc) return res.status(404).json({ message: 'Attribute not found' });
    const toObj = (m) => {
      if (!m) return {};
      if (typeof m.get === 'function') { const o = {}; for (const [k,v] of m.entries()) o[k]=v; return o; }
      return m;
    };
    res.json({ name: toObj(doc.name_i18n), description: toObj(doc.description_i18n) });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load i18n maps' });
  }
};

export const setAttributeI18n = async (req, res) => {
  try {
    const { name, description } = req.body || {};
    const doc = await Attribute.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Attribute not found' });
    let changed = false;
    if (name && typeof name === 'object') {
      const map = new Map(doc.name_i18n || []);
      for (const [lang, val] of Object.entries(name)) {
        const v = typeof val === 'string' ? val.trim() : '';
        if (!v) { if (map.has(lang)) { map.delete(lang); changed = true; } }
        else { const prev = map.get(lang); if (prev !== v) { map.set(lang, v); changed = true; } }
      }
      doc.name_i18n = map;
    }
    if (description && typeof description === 'object') {
      const map = new Map(doc.description_i18n || []);
      for (const [lang, val] of Object.entries(description)) {
        const v = typeof val === 'string' ? val.trim() : '';
        if (!v) { if (map.has(lang)) { map.delete(lang); changed = true; } }
        else { const prev = map.get(lang); if (prev !== v) { map.set(lang, v); changed = true; } }
      }
      doc.description_i18n = map;
    }
    if (changed) await doc.save();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'Failed to save i18n maps' });
  }
};

export const getAttributeValueI18n = async (req, res) => {
  try {
    const { attributeId, valueId } = req.params;
    // Ensure value belongs to attribute
    const doc = await AttributeValue.findOne({ _id: valueId, attribute: attributeId }).select('value_i18n').lean();
    if (!doc) return res.status(404).json({ message: 'Value not found' });
    const toObj = (m) => {
      if (!m) return {}; if (typeof m.get === 'function') { const o={}; for (const [k,v] of m.entries()) o[k]=v; return o; } return m;
    };
    res.json({ value: toObj(doc.value_i18n) });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load value i18n' });
  }
};

export const setAttributeValueI18n = async (req, res) => {
  try {
    const { attributeId, valueId } = req.params;
    const { value } = req.body || {};
    const doc = await AttributeValue.findOne({ _id: valueId, attribute: attributeId });
    if (!doc) return res.status(404).json({ message: 'Value not found' });
    if (value && typeof value === 'object') {
      const map = new Map(doc.value_i18n || []);
      let changed = false;
      for (const [lang, val] of Object.entries(value)) {
        const v = typeof val === 'string' ? val.trim() : '';
        if (!v) { if (map.has(lang)) { map.delete(lang); changed = true; } }
        else { const prev = map.get(lang); if (prev !== v) { map.set(lang, v); changed = true; } }
      }
      doc.value_i18n = map;
      if (changed) await doc.save();
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: 'Failed to save value i18n' });
  }
};
