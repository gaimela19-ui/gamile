import Hero from '../models/Hero.js';

export const getAllHeros = async (req, res) => {
  try {
    const heros = await Hero.find().sort({ createdAt: -1 });
    res.json(heros);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getActiveHero = async (req, res) => {
  try {
    const hero = await Hero.findOne({ isActive: true });
    // Absence of an active hero is not an exceptional condition for the UI; return null with 200
    if (!hero) {
      return res.json(null);
    }
    res.json(hero);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getSliderHeros = async (req, res) => {
  try {
    const heros = await Hero.find({ isInSlider: true })
      .sort({ sliderOrder: 1, createdAt: -1 });
    res.json(heros);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createHero = async (req, res) => {
  try {
      // Allow multiple hero banners to be active at the same time
  const hero = new Hero({ ...req.body });
  const savedHero = await hero.save();
  console.log('Saved hero:', savedHero);
  res.status(201).json(savedHero);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const updateHero = async (req, res) => {
  try {
      // Allow multiple hero banners to be active at the same time
    
    const hero = await Hero.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!hero) {
      return res.status(404).json({ message: 'Hero section not found' });
    }
    
    res.json(hero);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const deleteHero = async (req, res) => {
  try {
    const hero = await Hero.findByIdAndDelete(req.params.id);
    
    if (!hero) {
      return res.status(404).json({ message: 'Hero section not found' });
    }
    
    res.json({ message: 'Hero section deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};