import Warehouse from '../models/Warehouse.js';

// List all warehouses
export const getWarehouses = async (req, res) => {
  try {
    const warehouses = await Warehouse.find();
    res.json(warehouses);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch warehouses' });
  }
};

// Resolve the default warehouse using configuration or sensible fallbacks
export const getDefaultWarehouse = async (req, res) => {
  try {
    const isObjectId = (v) => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);
    const envId = process.env.DEFAULT_WAREHOUSE_ID;
    const envName = process.env.DEFAULT_WAREHOUSE_NAME;

    // 1) Prefer explicit ID from env
    if (envId && isObjectId(envId)) {
      const byId = await Warehouse.findById(envId).lean();
      if (byId) return res.json({ _id: String(byId._id), name: byId.name || '' });
    }
    // 2) Next prefer name from env (case-insensitive)
    if (envName && String(envName).trim()) {
      const byName = await Warehouse.findOne({ name: { $regex: `^${String(envName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }).lean();
      if (byName) return res.json({ _id: String(byName._id), name: byName.name || '' });
    }
    // 3) If exactly one exists, use it
    const all = await Warehouse.find({}).lean();
    if (Array.isArray(all) && all.length === 1) {
      const w = all[0];
      return res.json({ _id: String(w._id), name: w.name || '' });
    }
    // 4) Try a conventional name fallback
    const main = await Warehouse.findOne({ name: { $regex: '^Main Warehouse$', $options: 'i' } }).lean();
    if (main) return res.json({ _id: String(main._id), name: main.name || '' });

    // 5) No deterministic default
    return res.json(null);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to resolve default warehouse' });
  }
};

// Get a single warehouse by ID
export const getWarehouseById = async (req, res) => {
  try {
    const warehouse = await Warehouse.findById(req.params.id);
    if (!warehouse) return res.status(404).json({ error: 'Warehouse not found' });
    res.json(warehouse);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch warehouse' });
  }
};

// Create a new warehouse
export const createWarehouse = async (req, res) => {
  try {
    const warehouse = new Warehouse(req.body);
    await warehouse.save();
    res.status(201).json(warehouse);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Update a warehouse
export const updateWarehouse = async (req, res) => {
  try {
    const warehouse = await Warehouse.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!warehouse) return res.status(404).json({ error: 'Warehouse not found' });
    res.json(warehouse);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Delete a warehouse
export const deleteWarehouse = async (req, res) => {
  try {
    const warehouse = await Warehouse.findByIdAndDelete(req.params.id);
    if (!warehouse) return res.status(404).json({ error: 'Warehouse not found' });
    res.json({ message: 'Warehouse deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete warehouse' });
  }
};
