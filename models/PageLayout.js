import mongoose from 'mongoose';

const pageLayoutSchema = new mongoose.Schema({
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

// Ensure a singleton document pattern
// Historically, multiple documents could be created. To avoid returning an older
// layout after restarts, always select the most recently updated document and
// prune any duplicates in the background.
pageLayoutSchema.statics.getOrCreate = async function() {
  // Prefer the latest updated layout if multiple exist
  const docs = await this.find({}).sort({ updatedAt: -1 });
  let doc = docs[0];

  if (!doc) {
    doc = await this.create({ sections: [], sectionGap: 6 });
    return doc;
  }

  // Best-effort cleanup: remove older duplicates so subsequent calls are deterministic
  if (docs.length > 1) {
    const idsToDelete = docs.slice(1).map(d => d._id);
    try { await this.deleteMany({ _id: { $in: idsToDelete } }); } catch {}
  }

  // Migration: ensure gap exists
  if (typeof doc.sectionGap !== 'number') {
    doc.sectionGap = 6;
    try { await doc.save(); } catch {}
  }

  return doc;
};

const PageLayout = mongoose.model('PageLayout', pageLayoutSchema);

export default PageLayout;
