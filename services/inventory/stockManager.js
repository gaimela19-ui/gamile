import Product from '../../models/Product.js';
import Inventory from '../../models/Inventory.js';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../../utils/ApiError.js';

export class StockManager {
  async updateProductStock(productId) {
    try {
      const inventoryItems = await Inventory.find({ product: productId });
      const totalStock = inventoryItems.reduce((sum, item) => sum + item.quantity, 0);
      await Product.findByIdAndUpdate(productId, { stock: totalStock });
    } catch (error) {
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Error updating product stock'
      );
    }
  }

  async checkLowStock(productId) {
    try {
      const inventory = await Inventory.find({ product: productId });
      return inventory.some(item => item.status === 'low_stock');
    } catch (error) {
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'Error checking stock status'
      );
    }
  }
}