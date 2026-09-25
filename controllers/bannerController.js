import Banner from '../models/Banner.js';
import mongoose from 'mongoose';
import cloudinary from '../services/cloudinaryClient.js';

export const getBanners = async (req, res) => {
  try {
    const { platform, categorySlug, tag } = req.query || {};
    const filter = {};
    if (platform === 'mobile') Object.assign(filter, { $or: [{ platform: 'mobile' }, { platform: 'both' }] });
    if (platform === 'web') Object.assign(filter, { $or: [{ platform: 'web' }, { platform: 'both' }] });
    if (categorySlug) Object.assign(filter, { categorySlug });
    if (tag) Object.assign(filter, { tag });
    const banners = await Banner.find(filter).sort('order').select('-__v');
    res.json(banners);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getActiveBanners = async (req, res) => {
  try {
    const now = new Date();
    const { platform, categorySlug, tag } = req.query || {};
    const platformFilter = platform === 'mobile'
      ? { $or: [{ platform: 'mobile' }, { platform: 'both' }] }
      : platform === 'web'
        ? { $or: [{ platform: 'web' }, { platform: 'both' }] }
        : {};
    const banners = await Banner.find({
      isActive: true,
      ...platformFilter,
      ...(categorySlug ? { categorySlug } : {}),
      ...(tag ? { tag } : {}),
      $and: [
        { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: null }, { endDate: { $gte: now } }] }
      ]
    }).sort('order').select('-__v');
    res.json(banners);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createBanner = async (req, res) => {
  try {
    const order = await Banner.countDocuments();
    const { platform, categorySlug, tag } = req.body || {};
    // Default platform to 'web' for legacy callers
    const banner = new Banner({
      ...req.body,
      platform: ['web','mobile','both'].includes(platform) ? platform : 'web',
      categorySlug: categorySlug || '',
      tag: tag || '',
      order
    });
    const saved = await banner.save();
    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

export const updateBanner = async (req, res) => {
  try {
    const update = { ...req.body };
    if (update.platform && !['web','mobile','both'].includes(update.platform)) {
      return res.status(400).json({ message: 'Invalid platform' });
    }
    const banner = await Banner.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true }
    );
    if (!banner) return res.status(404).json({ message: 'Banner not found' });
    res.json(banner);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// Lightweight mobile endpoints using same Banner collection
export const getMobileBanners = async (req, res) => {
  try {
    const now = new Date();
    const { tag } = req.query || {};
    const q = {
      isActive: true,
      $or: [{ platform: 'mobile' }, { platform: 'both' }],
      ...(tag ? { tag } : {}),
      $and: [
        { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: null }, { endDate: { $gte: now } }] }
      ]
    };
    const banners = await Banner.find(q).sort('order').select('-__v');
    // Map to mobile-friendly payload (support image or video)
    const data = banners.map(b => ({
      id: b._id,
      type: b.mediaType === 'video' && b.videoUrl ? 'video' : 'image',
      image: b.imageUrl,
      video: b.videoUrl || '',
      poster: b.posterUrl || '',
      title: b.title,
      subtitle: b.subtitle || '',
      cta: b.cta || '',
      link: b.linkUrl || '',
      tag: b.tag || ''
    }));
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getMobileBannersByCategory = async (req, res) => {
  try {
    const now = new Date();
    const { slug } = req.params;
    const q = {
      isActive: true,
      $or: [{ platform: 'mobile' }, { platform: 'both' }],
      categorySlug: slug,
      $and: [
        { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: null }, { endDate: { $gte: now } }] }
      ]
    };
    const banners = await Banner.find(q).sort('order').select('-__v');
    const data = banners.map(b => ({
      id: b._id,
      type: b.mediaType === 'video' && b.videoUrl ? 'video' : 'image',
      image: b.imageUrl,
      video: b.videoUrl || '',
      poster: b.posterUrl || '',
      title: b.title,
      subtitle: b.subtitle || '',
      cta: b.cta || '',
      link: b.linkUrl || '',
      tag: b.tag || ''
    }));
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getMobileBannersByTag = async (req, res) => {
  try {
    const now = new Date();
    const { tag } = req.params;
    const q = {
      isActive: true,
      $or: [{ platform: 'mobile' }, { platform: 'both' }],
      tag,
      $and: [
        { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: null }, { endDate: { $gte: now } }] }
      ]
    };
    const banners = await Banner.find(q).sort('order').select('-__v');
    const data = banners.map(b => ({
      id: b._id,
      type: b.mediaType === 'video' && b.videoUrl ? 'video' : 'image',
      image: b.imageUrl,
      video: b.videoUrl || '',
      poster: b.posterUrl || '',
      title: b.title,
      subtitle: b.subtitle || '',
      cta: b.cta || '',
      link: b.linkUrl || '',
      tag: b.tag || ''
    }));
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteBanner = async (req, res) => {
  try {
    const banner = await Banner.findByIdAndDelete(req.params.id);
    if (!banner) return res.status(404).json({ message: 'Banner not found' });
    res.json({ message: 'Banner deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const reorderBanners = async (req, res) => {
  try {
    const payload = req.body?.banners || req.body?.items || req.body?.data;
    if (!Array.isArray(payload)) {
      return res.status(400).json({ message: 'Invalid payload: expected banners array' });
    }

    const updates = payload
      .map((raw) => {
        const id = raw?.id || raw?._id;
        const order = Number(raw?.order);
        return { id, order };
      })
      .filter((x) => x.id && mongoose.isValidObjectId(x.id) && Number.isFinite(x.order));

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No valid banners provided for reorder' });
    }

    await Banner.bulkWrite(
      updates.map(({ id, order }) => ({
        updateOne: { filter: { _id: id }, update: { $set: { order } } }
      }))
    );

    res.json({ message: 'Banners reordered successfully', updated: updates.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Upload a single banner video and attach to an existing banner
export const uploadBannerVideo = async (req, res) => {
  try {
    const id = req.params.id;
    const banner = await Banner.findById(id);
    if (!banner) return res.status(404).json({ message: 'Banner not found' });

    if (!req.file) return res.status(400).json({ message: 'No video file provided' });

    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: 'video', folder: 'banners/videos' },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    const url = uploadResult.secure_url;
    // Set media to video and store URL; preserve existing poster/image
    banner.mediaType = 'video';
    banner.videoUrl = url;
    // If imageUrl is empty, use posterUrl if available, otherwise fallback to video url (UI can override)
    if (!banner.imageUrl) {
      banner.imageUrl = banner.posterUrl || url;
    }
    await banner.save();

    res.status(201).json({ url, banner });
  } catch (error) {
    console.error('[banner][uploadVideo] error:', error?.message || error);
    res.status(500).json({ message: 'Failed to upload banner video', error: error.message });
  }
};

// Standalone banner video upload - returns Cloudinary URL (useful before creating banner)
export const uploadTempBannerVideo = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No video file provided' });

    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: 'video', folder: 'banners/videos' },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    res.status(201).json({ url: uploadResult.secure_url });
  } catch (error) {
    console.error('[banner][uploadTempVideo] error:', error?.message || error);
    res.status(500).json({ message: 'Failed to upload video', error: error.message });
  }
};
