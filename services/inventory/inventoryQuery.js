import Inventory from '../../models/Inventory.js';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../../utils/ApiError.js';

export class InventoryQuery {
  async getAll() {
    const inventory = await Inventory.find()
      .populate('product', 'name images')
      .populate({ path: 'attributesSnapshot.attribute', select: 'name' })
      .populate({ path: 'attributesSnapshot.value', select: 'value' })
      .sort({ 'product.name': 1, size: 1, color: 1 });
    return inventory;
  }

  async getByProduct(productId) {
    const inventory = await Inventory.find({ product: productId })
      .populate('product', 'name images')
      .populate({ path: 'attributesSnapshot.attribute', select: 'name' })
      .populate({ path: 'attributesSnapshot.value', select: 'value' })
      .sort('size color');
    return inventory;
  }

  async getLowStock() {
    const items = await Inventory.find({ status: 'low_stock' })
      .populate('product', 'name images')
      .populate({ path: 'attributesSnapshot.attribute', select: 'name' })
      .populate({ path: 'attributesSnapshot.value', select: 'value' })
      .sort('quantity');
    return items;
  }

  async findById(id) {
    const inventory = await Inventory.findById(id);
    if (!inventory) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Inventory record not found');
    }
    return inventory;
  }
}