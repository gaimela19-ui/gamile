import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../../utils/ApiError.js';
import { InventoryQuery } from './inventoryQuery.js';
import { InventoryUpdate } from './inventoryUpdate.js';
import { InventoryHistory } from './inventoryHistory.js';
import { StockManager } from './stockManager.js';

class InventoryService {
  constructor() {
    this.query = new InventoryQuery();
    this.update = new InventoryUpdate();
    this.history = new InventoryHistory();
    this.stockManager = new StockManager();
  }

  async getAllInventory() {
    try {
      return await this.query.getAll();
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error fetching inventory');
    }
  }

  async getProductInventory(productId) {
    try {
      return await this.query.getByProduct(productId);
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error fetching product inventory');
    }
  }

  async updateInventory(id, quantity, userId) {
    try {
      const inventory = await this.update.updateQuantity(id, quantity);
      await this.stockManager.updateProductStock(inventory.product._id);
      await this.history.createRecord({
        product: inventory.product._id,
        type: 'update',
        quantity,
        reason: 'Manual update',
        user: userId
      });
      return inventory;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, error.message);
    }
  }

  async addInventory(data, userId) {
    try {
      const inventory = await this.update.create(data);
      await this.stockManager.updateProductStock(inventory.product);
      await this.history.createRecord({
        product: inventory.product,
        type: 'increase',
        quantity: inventory.quantity,
        reason: 'Initial stock',
        user: userId
      });
      return inventory;
    } catch (error) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Error adding inventory record');
    }
  }

  async getLowStockItems() {
    try {
      return await this.query.getLowStock();
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error fetching low stock items');
    }
  }

  async bulkUpdateInventory(items, userId) {
    try {
      for (const item of items) {
        const inventory = await this.update.updateQuantity(item._id, item.quantity);
        await this.stockManager.updateProductStock(inventory.product);
        await this.history.createRecord({
          product: inventory.product,
          type: 'update',
          quantity: item.quantity,
          reason: 'Bulk update',
          user: userId
        });
      }
    } catch (error) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Error performing bulk update');
    }
  }
}

export const inventoryService = new InventoryService();