import mongoose from 'mongoose';

const announcementSchema = new mongoose.Schema({
  text: {
    type: String,
    required: [true, 'Announcement text is required'],
    trim: true,
    maxLength: [100, 'Announcement text cannot exceed 100 characters']
  },
  // Optional localized announcement texts
  textAr: {
    type: String,
    trim: true,
    maxLength: [100, 'Announcement text (Arabic) cannot exceed 100 characters'],
    default: ''
  },
  textHe: {
    type: String,
    trim: true,
    maxLength: [100, 'Announcement text (Hebrew) cannot exceed 100 characters'],
    default: ''
  },
  description: {
    type: String,
    trim: true,
    maxLength: [150, 'Description cannot exceed 150 characters'],
    default: ''
  },
  // Optional localized descriptions
  descriptionAr: {
    type: String,
    trim: true,
    maxLength: [150, 'Description (Arabic) cannot exceed 150 characters'],
    default: ''
  },
  descriptionHe: {
    type: String,
    trim: true,
    maxLength: [150, 'Description (Hebrew) cannot exceed 150 characters'],
    default: ''
  },
  url: {
    type: String,
    trim: true,
    default: '',
    validate: {
      validator: function(v) {
        if (!v) return true;
        // allow http/https URLs and site-relative paths starting with '/'
        return /^(https?:\/\/[^\s]+|\/[\S]*)$/i.test(v);
      },
      message: 'URL must be absolute (http/https) or a site-relative path starting with /'
    }
  },
  // Target platform: web, mobile, or both
  platform: {
    type: String,
    enum: ['web', 'mobile', 'both'],
    default: 'both',
    index: true
  },
  iconImage: {
    type: String,
    trim: true,
    default: ''
  },
  icon: {
    type: String,
    required: [true, 'Icon name is required'],
    enum: ['Truck', 'Sparkles', 'Clock', 'CreditCard', 'Star', 'Gift', 'Heart', 'Tag'],
    default: 'Star'
  },
  iconSize: {
    type: Number,
    min: [12, 'Icon size cannot be less than 12'],
    max: [48, 'Icon size cannot be greater than 48'],
    default: 18
  },
  fontSize: {
    type: String,
    enum: ['xs', 'sm', 'base', 'lg', 'xl'],
    default: 'sm'
  },
  textColor: {
    type: String,
    default: '#FFFFFF',
    validate: {
      validator: function(v) {
        return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(v);
      },
      message: 'Invalid hex color code'
    }
  },
  backgroundColor: {
    type: String,
    default: '#4F46E5',
    validate: {
      validator: function(v) {
        return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(v);
      },
      message: 'Invalid hex color code'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

export default mongoose.model('Announcement', announcementSchema);