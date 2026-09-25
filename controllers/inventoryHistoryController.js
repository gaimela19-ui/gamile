import InventoryHistory from '../models/InventoryHistory.js';

export const getInventoryHistory = async (req, res) => {
  try {
    const history = await InventoryHistory.find()
      .populate('product', 'name')
      .populate('user', 'name')
      .sort('-timestamp')
      .limit(50);
    res.json(history);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const addInventoryHistory = async (req, res) => {
  try {
    const history = new InventoryHistory({
      ...req.body,
      user: req.user._id
    });
    const savedHistory = await history.save();
    res.status(201).json(savedHistory);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};