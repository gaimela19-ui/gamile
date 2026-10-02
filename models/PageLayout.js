import mongoose from 'mongoose';

const pageLayoutSchema = new mongoose.Schema({
  singletonKey: {
    type: String,
    unique: true,
    sparse: true
  },
  sections: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  // Global vertical gap (Tailwind scale number). Frontend interprets as gap * 0.25rem.
  sectionGap: {
    type: Number,
    default: 6
  }
}, {
  timestamps: true
});

pageLayoutSchema.statics.getOrCreate = async function() {
  const existing = await this.findOne({ singletonKey: 'store' });
  if (existing) return existing;

  const latest = await this.findOne({}).sort({ updatedAt: -1, _id: -1 });
  try {
    if (latest) {
      return await this.findOneAndUpdate(
        { _id: latest._id },
        { $set: { singletonKey: 'store' } },
        { new: true }
      );
    }
    return await this.findOneAndUpdate(
      { singletonKey: 'store' },
      { $setOnInsert: { sections: [], sectionGap: 6 } },
      { upsert: true, new: true }
    );
  } catch (error) {
    if (error.code === 11000) return this.findOne({ singletonKey: 'store' });
    throw error;
  }
};

const PageLayout = mongoose.model('PageLayout', pageLayoutSchema);

export default PageLayout;
