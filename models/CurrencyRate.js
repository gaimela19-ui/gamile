import mongoose from 'mongoose';

const currencyRateSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  exchangeRate: {
    type: Number,
    required: true,
    min: 0
  },
  enabled: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

const CurrencyRate = mongoose.model('CurrencyRate', currencyRateSchema);
export default CurrencyRate;
