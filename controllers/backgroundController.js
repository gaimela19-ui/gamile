import Background from '../models/Background.js';

export const getBackgrounds = async (req, res) => {
  try {
    const backgrounds = await Background.find().sort('order');
    res.json(backgrounds);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getActiveBackground = async (req, res) => {
  try {
    const background = await Background.findOne({ isActive: true });
    if (!background) {
      return res.status(404).json({ message: 'No active background found' });
    }
    res.json(background);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createBackground = async (req, res) => {
  try {
    if (req.body.isActive) {
      await Background.updateMany({}, { isActive: false });
    }
    
    const background = new Background({
      ...req.body,
      order: await Background.countDocuments()
    });
    
    const savedBackground = await background.save();
    res.status(201).json(savedBackground);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const updateBackground = async (req, res) => {
  try {
    if (req.body.isActive) {
      await Background.updateMany(
        { _id: { $ne: req.params.id } },
        { isActive: false }
      );
    }
    
    const background = await Background.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!background) {
      return res.status(404).json({ message: 'Background not found' });
    }
    
    res.json(background);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const deleteBackground = async (req, res) => {
  try {
    const background = await Background.findByIdAndDelete(req.params.id);
    
    if (!background) {
      return res.status(404).json({ message: 'Background not found' });
    }
    
    res.json({ message: 'Background deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const reorderBackgrounds = async (req, res) => {
  try {
    const { backgrounds } = req.body;
    await Promise.all(
      backgrounds.map(({ id, order }) => 
        Background.findByIdAndUpdate(id, { order })
      )
    );
    res.json({ message: 'Backgrounds reordered successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};