import mongoose from 'mongoose';

const backgroundSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Background name is required'],
    trim: true
  },
  type: {
    type: String,
    enum: ['color', 'gradient', 'pattern'],
    required: true
  },
  value: {
    type: String,
    required: [true, 'Background value is required']
  },
  isActive: {
    type: Boolean,
    default: false
  },
  order: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Static method to create default background
backgroundSchema.statics.createDefaultBackground = async function() {
  try {
    const existingBackground = await this.findOne({ isActive: true });
    if (!existingBackground) {
      await this.create({
        name: 'Default Background',
        type: 'color',
        value: '#ffffff',
        isActive: true,
        order: 0
      });
      console.log('Default background created successfully');
    }
  } catch (error) {
    console.error('Error creating default background:', error.message);
  }
};

const Background = mongoose.model('Background', backgroundSchema);

export default Background;