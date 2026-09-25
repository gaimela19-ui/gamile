// Create recipient
export const createRecipient = async (req, res) => {
  try {
    const recipient = new Recipient(req.body);
    await recipient.save();
    res.status(201).json(recipient);
  } catch (error) {
    res.status(400).json({ message: 'Failed to create recipient', error: error.message });
  }
};
import Recipient from '../models/Recipient.js';

// List all recipients
export const getRecipients = async (req, res) => {
  try {
    const recipients = await Recipient.find().sort('-createdAt');
    res.json(recipients);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch recipients', error: error.message });
  }
};

// Get recipient by ID
export const getRecipientById = async (req, res) => {
  try {
    const recipient = await Recipient.findById(req.params.id);
    if (!recipient) return res.status(404).json({ message: 'Recipient not found' });
    res.json(recipient);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch recipient', error: error.message });
  }
};

// Update recipient
export const updateRecipient = async (req, res) => {
  try {
    const updated = await Recipient.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) return res.status(404).json({ message: 'Recipient not found' });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update recipient', error: error.message });
  }
};

// Delete recipient
export const deleteRecipient = async (req, res) => {
  try {
    const deleted = await Recipient.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Recipient not found' });
    res.json({ message: 'Recipient deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete recipient', error: error.message });
  }
};
