import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { normalizePhoneE164ish } from '../utils/phone.js';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  // OAuth provider (e.g., 'google') or 'local'
  provider: {
    type: String,
    enum: ['local', 'google', 'facebook', 'apple'],
    default: 'local',
    index: true
  },
  // Google OAuth subject identifier
  googleId: {
    type: String,
    index: true,
    sparse: true,
    unique: true
  },
  // Facebook OAuth user identifier
  facebookId: {
    type: String,
    index: true,
    sparse: true,
    unique: true
  },
  // Apple Sign In subject identifier
  appleId: {
    type: String,
    index: true,
    sparse: true,
    unique: true
  },
  // Optional phone number for WhatsApp / SMS (E.164 format preferred e.g. +15551234567)
  phoneNumber: {
    type: String,
    trim: true,
    unique: true,
    sparse: true, // Allow many users without phone numbers
    match: [/^\+?[1-9]\d{6,15}$/, 'Invalid phone number format']
  },
  addressLine1: {
    type: String,
    trim: true,
    default: ''
  },
  addressLine2: {
    type: String,
    trim: true,
    default: ''
  },
  city: {
    type: String,
    trim: true,
    default: ''
  },
  state: {
    type: String,
    trim: true,
    default: ''
  },
  postalCode: {
    type: String,
    trim: true,
    default: ''
  },
  country: {
    type: String,
    trim: true,
    default: ''
  },
  password: {
    type: String,
    // For OAuth accounts (e.g., Google) password can be omitted
    required: function() { return this.provider === 'local'; },
    minlength: [6, 'Password must be at least 6 characters']
  },
  image: {
    type: String
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  whatsappOptIn: {
    type: Boolean,
    default: false, // Explicit user consent required for marketing messages
    index: true
  },
  lastWhatsAppContactAt: {
    type: Date
  },
  lastWhatsAppMessagePreview: {
    type: String,
    maxlength: 160
  },
  notificationPreferences: {
    orderUpdates: {
      type: Boolean,
      default: true
    },
    newArrivals: {
      type: Boolean,
      default: true
    },
    specialOffers: {
      type: Boolean,
      default: true
    }
  },
  lastPasswordChange: {
    type: Date,
    default: Date.now
  },
  lastLoginAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes to optimize admin customer listing queries
userSchema.index({ createdAt: -1 });
userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ phoneNumber: 1 });
userSchema.index({ whatsappOptIn: 1 });
userSchema.index({ provider: 1, googleId: 1 });
userSchema.index({ provider: 1, facebookId: 1 });
userSchema.index({ provider: 1, appleId: 1 });
// Compound text index for name/email search (case-insensitive regex still used, but this can help if migrated to $text)
// Note: Using weights in case future $text search introduced
userSchema.index({ name: 'text', email: 'text' }, { weights: { name: 5, email: 10 }, name: 'UserTextIndex' });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
    this.lastPasswordChange = new Date();
  }
  // Normalize phone number consistently
  if (this.isModified('phoneNumber') && this.phoneNumber) {
    this.phoneNumber = normalizePhoneE164ish(this.phoneNumber);
  }
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Create default admin user if none exists
userSchema.statics.createDefaultAdmin = async function() {
  try {
    const adminExists = await this.findOne({ role: 'admin' });
    if (!adminExists) {
      await this.create({
        name: 'Admin User',
        email: 'admin@example.com',
        password: 'admin123',
        role: 'admin'
      });
      console.log('Default admin user created successfully');
    }
  } catch (error) {
    console.error('Error creating default admin:', error);
  }
};

const User = mongoose.model('User', userSchema);

export default User;