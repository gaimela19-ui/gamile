import mongoose from 'mongoose';

const footerSettingsSchema = new mongoose.Schema({
  isVisible: {
    type: Boolean,
    default: true
  },
  // Section visibility toggles
  sections: {
    newsletter: { type: Boolean, default: true },
    links: { type: Boolean, default: true },
    contactInfo: { type: Boolean, default: true },
    socialLinks: { type: Boolean, default: true },
    appBadges: { type: Boolean, default: true },
    logoDescription: { type: Boolean, default: true },
    map: { type: Boolean, default: true },
    mainCategories: { type: Boolean, default: true }
  },
  description: {
    type: String,
    default: 'Discover luxury fashion that combines timeless elegance with modern style.'
  },
  // Localized content
  description_i18n: { type: Map, of: String, default: undefined },
  // Optional background image URL for the footer
  backgroundImage: {
    type: String,
    default: ''
  },
  address: {
    type: String,
    default: '123 Fashion Street, NY 10001'
  },
  phone: {
    type: String,
    default: '+1 (555) 123-4567'
  },
  email: {
    type: String,
    default: 'contact@evacurves.com'
  },
  socialLinks: {
    facebook: String,
    twitter: String,
    instagram: String,
    youtube: String
  },
  // Optional app store badges (images and links)
  appBadges: {
    android: {
      imageUrl: { type: String, default: '' },
      linkUrl: { type: String, default: '' }
    },
    ios: {
      imageUrl: { type: String, default: '' },
      linkUrl: { type: String, default: '' }
    }
  },
  newsletter: {
    title: {
      type: String,
      default: 'Join Our Newsletter'
    },
    title_i18n: { type: Map, of: String, default: undefined },
    subtitle: {
      type: String,
      default: 'Subscribe to get special offers, free giveaways, and exclusive deals.'
    },
    subtitle_i18n: { type: Map, of: String, default: undefined },
    placeholder: {
      type: String,
      default: 'Enter your email'
    },
    placeholder_i18n: { type: Map, of: String, default: undefined },
    buttonText: {
      type: String,
      default: 'Subscribe'
    }
    ,
    buttonText_i18n: { type: Map, of: String, default: undefined }
  }
}, {
  timestamps: true
});

// Create default settings if none exist
footerSettingsSchema.statics.createDefaultSettings = async function() {
  try {
    const settings = await this.findOne();
    if (!settings) {
      await this.create({});
      console.log('Default footer settings created successfully');
    }
  } catch (error) {
    console.error('Error creating default footer settings:', error);
  }
};

const FooterSettings = mongoose.model('FooterSettings', footerSettingsSchema);

export default FooterSettings;