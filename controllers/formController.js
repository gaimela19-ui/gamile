import asyncHandler from 'express-async-handler';
import Form from '../models/Form.js';

// GET /api/forms
export const listForms = asyncHandler(async (req, res) => {
  const forms = await Form.find({ isActive: true }).sort({ name: 1 }).lean();
  res.json(forms);
});

export default { listForms };
