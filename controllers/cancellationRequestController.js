import CancellationRequest from '../models/CancellationRequest.js';
import { StatusCodes } from 'http-status-codes';

export async function createCancellationRequest(req, res) {
  try {
    const { name, phone, email, order, content, optIn } = req.body || {};
    if (!name || !phone || !email || !content) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Missing required fields' });
    }
    const doc = await CancellationRequest.create({ name, phone, email, order, content, optIn: !!optIn });
    return res.status(StatusCodes.CREATED).json(doc);
  } catch (e) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: e.message || 'Failed to create request' });
  }
}

export async function listCancellationRequests(req, res) {
  try {
    const status = req.query?.status;
    const filter = status ? { status } : {};
    const list = await CancellationRequest.find(filter).sort({ createdAt: -1 }).lean();
    return res.json(list);
  } catch (e) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: e.message || 'Failed to list requests' });
  }
}

export async function updateCancellationRequest(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!['pending', 'resolved'].includes(status)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Invalid status' });
    }
    const updated = await CancellationRequest.findByIdAndUpdate(id, { status }, { new: true });
    if (!updated) return res.status(StatusCodes.NOT_FOUND).json({ message: 'Request not found' });
    return res.json(updated);
  } catch (e) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: e.message || 'Failed to update request' });
  }
}
