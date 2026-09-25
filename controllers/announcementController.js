import Announcement from '../models/Announcement.js';
import mongoose from 'mongoose';

export const getAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcement.find()
      .sort('order')
      .select('-__v');
    res.json(announcements);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getActiveAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcement.find({ isActive: true })
      .sort('order')
      .select('-__v');
    res.json(announcements);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Platform-aware: mobile
export const getActiveAnnouncementsMobile = async (req, res) => {
  try {
    const announcements = await Announcement.find({
      isActive: true,
      $or: [
        { platform: { $in: ['mobile', 'both'] } },
        { platform: { $exists: false } }
      ]
    })
      .sort('order')
      .select('-__v');
    res.json(announcements);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Platform-aware: web
export const getActiveAnnouncementsWeb = async (req, res) => {
  try {
    const announcements = await Announcement.find({
      isActive: true,
      $or: [
        { platform: { $in: ['web', 'both'] } },
        { platform: { $exists: false } }
      ]
    })
      .sort('order')
      .select('-__v');
    res.json(announcements);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createAnnouncement = async (req, res) => {
  try {
    const announcement = new Announcement({
      ...req.body,
      order: await Announcement.countDocuments()
    });
    const savedAnnouncement = await announcement.save();
    res.status(201).json(savedAnnouncement);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const updateAnnouncement = async (req, res) => {
  try {
    const announcement = await Announcement.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!announcement) {
      return res.status(404).json({ message: 'Announcement not found' });
    }
    
    res.json(announcement);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const deleteAnnouncement = async (req, res) => {
  try {
    const announcement = await Announcement.findByIdAndDelete(req.params.id);
    
    if (!announcement) {
      return res.status(404).json({ message: 'Announcement not found' });
    }
    
    res.json({ message: 'Announcement deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const reorderAnnouncements = async (req, res) => {
  try {
    const payload = req.body?.announcements || req.body?.items || req.body?.data;
    if (!Array.isArray(payload)) {
      return res.status(400).json({ message: 'Invalid payload: expected announcements array' });
    }

    // Normalize and validate
    const updates = payload
      .map((raw) => {
        const id = raw?.id || raw?._id;
        const order = Number(raw?.order);
        return { id, order };
      })
      .filter((x) => x.id && mongoose.isValidObjectId(x.id) && Number.isFinite(x.order));

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No valid announcements provided for reorder' });
    }

    // Use bulkWrite for atomic updates and performance
    await Announcement.bulkWrite(
      updates.map(({ id, order }) => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: { order } }
        }
      }))
    );

    res.json({ message: 'Announcements reordered successfully', updated: updates.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};