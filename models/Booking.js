import mongoose from 'mongoose';

const ServiceSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  durationMin: { type: Number, required: true },
  price: { type: Number, required: true },
}, { _id: false });

const BookingSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  petId: { type: String }, // basic reference or external id
  date: { type: String, required: true }, // YYYY-MM-DD
  time: { type: String, required: true }, // HH:MM
  services: { type: [ServiceSchema], default: [] },
  status: { type: String, default: 'pending' },
  notes: { type: String },
}, {
  timestamps: true
});

// Prevent duplicate booking for same slot (optional uniqueness constraint)
BookingSchema.index({ date: 1, time: 1, user: 1 }, { unique: false });

export default mongoose.models.Booking || mongoose.model('Booking', BookingSchema);