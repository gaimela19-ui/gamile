import mongoose from 'mongoose';

const heroSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  subtitle: {
    type: String,
    required: true
  },
  image: {
    type: String,
    required: false
  },
  video: {
    type: String,
    required: false
  },
  primaryButtonText: {
    type: String,
    default: 'Shop Collection'
  },
  secondaryButtonText: {
    type: String,
    default: 'Explore Lookbook'
  },
  // Styling for primary CTA button
  primaryButtonBgColor: {
    type: String,
    default: '#b58955' // gold-like default matching current design
  },
  primaryButtonTextColor: {
    type: String,
    default: '#ffffff'
  },
  primaryButtonFontFamily: {
    type: String,
    default: 'inherit'
  },
  // Optional: include this hero in homepage slider
  isInSlider: {
    type: Boolean,
    default: false
  },
  sliderOrder: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Custom validation: at least one of image or video is required
heroSchema.pre('validate', function(next) {
  if (!this.image && !this.video) {
    this.invalidate('image', 'Either image or video is required.');
    this.invalidate('video', 'Either image or video is required.');
  }
  next();
});

export default mongoose.model('Hero', heroSchema);