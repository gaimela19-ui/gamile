import mongoose from 'mongoose';

const recipientSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true
  },
  lastName: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true
  },
  mobile: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^\+[0-9]{1,4}[0-9]{9,10}$/.test(v);
      },
      message: 'Invalid mobile number format'
    }
  },
  secondaryMobile: {
    type: String,
    validate: {
      validator: function(v) {
        return !v || /^\+[0-9]{1,4}[0-9]{9,10}$/.test(v);
      },
      message: 'Invalid secondary mobile number format'
    }
  },
  address: {
    street: { type: String, required: true },
    city: { type: String, required: true },
    country: { type: String, required: true },
    areaGroup: { type: String, default: '' }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Recipient = mongoose.model('Recipient', recipientSchema);
export default Recipient;
