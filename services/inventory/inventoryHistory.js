import InventoryHistoryModel from '../../models/InventoryHistory.js';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../../utils/ApiError.js';

export class InventoryHistory {
  async createRecord(data) {
    try {
      const history = new InventoryHistoryModel(data);
      await history.save();
    } catch (error) {
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Error creating history record'
      );
    }
  }

  async getHistory(productId) {
    try {
      return await InventoryHistoryModel.find({ product: productId })
        .populate('user', 'name')
        .sort('-createdAt');
    } catch (error) {
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Error fetching history records'
      );
    }
  }
}