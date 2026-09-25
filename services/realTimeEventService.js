import { broadcastToClients } from '../index.js';

class RealTimeEventService {
  // Emit new order event
  emitNewOrder(order) {
    broadcastToClients({
      type: 'new_order',
      data: {
        type: 'new_order',
        order: {
          _id: order._id,
          orderNumber: order.orderNumber,
          totalAmount: order.totalAmount,
          status: order.status,
          customerInfo: order.customerInfo,
          items: order.items?.map(item => ({
            product: { name: item.product?.name || 'Unknown Product' },
            quantity: item.quantity
          })) || []
        }
      }
    });

    console.log(`Broadcasted new order: ${order.orderNumber}`);
  }

  // Emit order status update
  emitOrderUpdate(order) {
    broadcastToClients({
      type: 'order_updated',
      data: {
        type: 'order_updated',
        order: {
          _id: order._id,
          orderNumber: order.orderNumber,
          totalAmount: order.totalAmount,
          status: order.status,
          customerInfo: order.customerInfo,
          items: order.items?.map(item => ({
            product: { name: item.product?.name || 'Unknown Product' },
            quantity: item.quantity
          })) || []
        }
      }
    });

    console.log(`Broadcasted order update: ${order.orderNumber} - ${order.status}`);
  }

  // Emit sales update
  emitSalesUpdate(salesData) {
    broadcastToClients({
      type: 'sales_update',
      data: {
        type: 'sales_update',
        data: salesData
      }
    });

    console.log('Broadcasted sales update');
  }

  // Emit inventory alert
  emitInventoryAlert(alert) {
    broadcastToClients({
      type: 'inventory_alert',
      data: {
        message: alert.message,
        severity: alert.severity || 'medium',
        productId: alert.productId,
        currentStock: alert.currentStock
      }
    });

    console.log(`Broadcasted inventory alert: ${alert.message}`);
  }

  // Emit system notification
  emitSystemNotification(notification) {
    broadcastToClients({
      type: 'system_notification',
      data: notification
    });

    console.log(`Broadcasted system notification: ${notification.message}`);
  }

  // Emit inventory changed event (e.g., product deleted, deactivated, stock reset)
  // Payload example: { productId: string, action: 'deleted' | 'hard_deleted' | 'deactivated' | 'updated' }
  emitInventoryChanged(change) {
    try {
      const payload = {
        type: 'inventory_changed',
        data: {
          productId: change?.productId,
          action: change?.action || 'updated'
        }
      };
      broadcastToClients(payload);
      console.log('[realtime] Broadcasted inventory_changed:', payload.data);
    } catch (e) {
      try { console.warn('emitInventoryChanged failed:', e?.message || e); } catch {}
    }
  }

  // Real-time sales updates based on actual database data
  async startPeriodicUpdates() {
    // Cache the last sales data to avoid unnecessary broadcasts
    let lastSalesData = null;

    setInterval(async () => {
      try {
        // Get real sales data from the last 30 days
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const Order = (await import('../models/Order.js')).default;

        const orders = await Order.find({
          createdAt: { $gte: thirtyDaysAgo },
          status: { $in: ['delivered', 'processing', 'shipped'] }
        });

        const totalSales = orders.reduce((sum, order) => sum + order.totalAmount, 0);
        const totalOrders = orders.length;

        // Calculate unique customers as active users
        const uniqueCustomers = new Set(orders.map(order =>
          order.customerInfo ? `${order.customerInfo.firstName}-${order.customerInfo.lastName}` : 'guest'
        ));
        const activeUsers = uniqueCustomers.size;

        // Calculate growth compared to previous 30 days
        const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        const previousOrders = await Order.find({
          createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo },
          status: { $in: ['delivered', 'processing', 'shipped'] }
        });

        const previousSales = previousOrders.reduce((sum, order) => sum + order.totalAmount, 0);
        const growth = previousSales > 0 ? (((totalSales - previousSales) / previousSales) * 100).toFixed(1) : '0.0';

        const realSalesData = {
          totalSales: Math.round(totalSales),
          totalOrders,
          activeUsers,
          growth
        };

        // Only broadcast if data has changed significantly
        if (!lastSalesData ||
            Math.abs(lastSalesData.totalSales - realSalesData.totalSales) > 10 ||
            lastSalesData.totalOrders !== realSalesData.totalOrders) {
          this.emitSalesUpdate(realSalesData);
          lastSalesData = realSalesData;
        }
      } catch (error) {
        console.error('Error fetching real sales data:', error);
      }
    }, 120000); // Every 2 minutes instead of 30 seconds

    console.log('Started periodic sales updates');
  }

  // Real inventory monitoring based on actual stock levels
  async startInventoryAlerts() {
    // Track already alerted products to avoid spam
    const alertedProducts = new Set();

    setInterval(async () => {
      try {
        // Check real inventory levels from database
        const Inventory = (await import('../models/Inventory.js')).default;
        const Product = (await import('../models/Product.js')).default;

        // Find products with low stock (< 10 units)
        const lowStockProducts = await Product.find({
          stock: { $lt: 10, $gt: 0 }
        }).limit(5);

        // Find out of stock products
        const outOfStockProducts = await Product.find({
          stock: { $lte: 0 }
        }).limit(3);

        // Send alerts for low stock (only once per product per session)
        for (const product of lowStockProducts) {
          const alertKey = `low-${product._id}`;
          if (!alertedProducts.has(alertKey) && Math.random() > 0.8) { // Reduced frequency
            this.emitInventoryAlert({
              message: `Low stock alert: ${product.name} - only ${product.stock} units remaining`,
              severity: 'medium',
              productId: product._id,
              currentStock: product.stock
            });
            alertedProducts.add(alertKey);
          }
        }

        // Send alerts for out of stock (only once per product per session)
        for (const product of outOfStockProducts) {
          const alertKey = `out-${product._id}`;
          if (!alertedProducts.has(alertKey) && Math.random() > 0.9) { // Very reduced frequency
            this.emitInventoryAlert({
              message: `Out of stock: ${product.name}`,
              severity: 'high',
              productId: product._id,
              currentStock: 0
            });
            alertedProducts.add(alertKey);
          }
        }

        // Clear old alerts periodically (every 10 minutes)
        if (alertedProducts.size > 50) {
          alertedProducts.clear();
        }
      } catch (error) {
        console.error('Error checking inventory levels:', error);
      }
    }, 300000); // Every 5 minutes instead of 1 minute

    console.log('Started real inventory monitoring');
  }
}

export const realTimeEventService = new RealTimeEventService();

// Start demo updates when the module is loaded unless DB is skipped.
if (process.env.SKIP_DB === '1') {
  console.warn('[realtime] SKIP_DB=1 – skipping periodic sales/inventory monitoring intervals');
} else {
  realTimeEventService.startPeriodicUpdates();
  realTimeEventService.startInventoryAlerts();
}
