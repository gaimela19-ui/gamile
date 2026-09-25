import mongoose from 'mongoose';

const bannerSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Banner title is required'],
    trim: true,
    maxLength: [150, 'Title cannot exceed 150 characters']
  },
  subtitle: {
    type: String,
    default: '',
    trim: true,
    maxLength: [200, 'Subtitle cannot exceed 200 characters']
  },
  imageUrl: {
    type: String,
    required: [true, 'Image URL is required'],
    trim: true
  },
  // Optional video support for banners
  mediaType: {
    type: String,
    enum: ['image', 'video'],
    default: 'image',
    index: true
  },
  videoUrl: {
    type: String,
    default: '',
    trim: true
  },
  // Poster image to show before/while loading the video
  posterUrl: {
    type: String,
    default: '',
    trim: true
  },
  linkUrl: {
    type: String,
    default: ''
  },
  cta: {
    type: String,
    default: ''
  },
  platform: {
    type: String,
    enum: ['web', 'mobile', 'both'],
    default: 'web',
    index: true
  },
  // Optional: target banners to a specific category slug (used by mobile route /by-category/:slug)
  categorySlug: {
    type: String,
    default: '',
    trim: true,
    index: true
  },
  // Optional: target banners to a specific tag (e.g., 'accessories')
  tag: {
    type: String,
    default: '',
    trim: true,
    index: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  startDate: {
    type: Date,
    default: null
  },
  endDate: {
    type: Date,
    default: null
  },
  order: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

export default mongoose.model('Banner', bannerSchema);
