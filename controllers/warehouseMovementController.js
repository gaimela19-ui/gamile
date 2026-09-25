import WarehouseMovement from '../models/WarehouseMovement.js';

// List all warehouse movements (optionally filter by query params)
export const getWarehouseMovements = async (req, res) => {
  try {
    const { product, fromWarehouse, toWarehouse, startDate, endDate } = req.query;
    const filter = {};
    if (product) filter.product = product;
    if (fromWarehouse) filter.fromWarehouse = fromWarehouse;
    if (toWarehouse) filter.toWarehouse = toWarehouse;
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }
    const movements = await WarehouseMovement.find(filter)
      .populate('product', 'name')
      .populate('fromWarehouse', 'name')
      .populate('toWarehouse', 'name')
      .populate('user', 'email')
      .sort('-date');
    res.json(movements);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch warehouse movements' });
  }
};

// Get a single movement by ID
export const getWarehouseMovementById = async (req, res) => {
  try {
    const movement = await WarehouseMovement.findById(req.params.id)
      .populate('product', 'name')
      .populate('fromWarehouse', 'name')
      .populate('toWarehouse', 'name')
      .populate('user', 'email');
    if (!movement) return res.status(404).json({ error: 'Movement not found' });
    res.json(movement);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch movement' });
  }
};
