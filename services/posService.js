import mongoose from 'mongoose';
import POSTransaction from '../models/POSTransaction.js';
import POSSession from '../models/POSSession.js';
import Product from '../models/Product.js';

export class POSService {
  
  /**
   * Validate and calculate transaction totals
   */
  async validateAndCalculateTransaction(transactionData) {
    const { items, paymentMethod, payments, customerInfo, discounts = [], currency } = transactionData;
    
    if (!items || items.length === 0) {
      throw new Error('Transaction must have at least one item');
    }
    
    let subtotal = 0;
    let totalTax = 0;
    let totalDiscount = 0;
    
    // Process each item
    const processedItems = await Promise.all(
      items.map(async (item) => {
        const product = await Product.findById(item.product);
        if (!product || !product.isActive) {
          throw new Error(`Product ${item.product} not found or inactive`);
        }
        
        let unitPrice = item.unitPrice || product.price;
        let itemTotal = unitPrice * item.quantity;
        
        // Apply item-level discount
        let itemDiscount = 0;
        if (item.discount) {
          if (item.discount.percentage) {
            itemDiscount = (itemTotal * item.discount.percentage) / 100;
          } else if (item.discount.amount) {
            itemDiscount = item.discount.amount;
          }
          itemTotal -= itemDiscount;
        }
        
        // Calculate tax
        let itemTax = 0;
        if (item.tax && item.tax.rate) {
          itemTax = (itemTotal * item.tax.rate) / 100;
        }
        
        subtotal += itemTotal;
        totalTax += itemTax;
        totalDiscount += itemDiscount;
        
        return {
          ...item,
          unitPrice,
          totalPrice: itemTotal + itemTax,
          productName: product.name,
          productSku: product.sku,
          discount: {
            amount: itemDiscount,
            percentage: item.discount?.percentage || 0,
            reason: item.discount?.reason || ''
          },
          tax: {
            rate: item.tax?.rate || 0,
            amount: itemTax
          }
        };
      })
    );
    
    // Apply transaction-level discounts
    discounts.forEach(discount => {
      if (discount.type === 'percentage') {
        totalDiscount += (subtotal * discount.value) / 100;
      } else if (discount.type === 'fixed') {
        totalDiscount += discount.value;
      }
    });
    
    const total = subtotal + totalTax - totalDiscount;
    
    // Validate payment
    let amountPaid = 0;
    if (payments && payments.length > 0) {
      amountPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);
    }
    
    if (amountPaid < total) {
      throw new Error('Insufficient payment amount');
    }
    
    const change = amountPaid - total;
    
    return {
      items: processedItems,
      subtotal,
      totalTax,
      totalDiscount,
      total,
      amountPaid,
      change
    };
  }
  
  /**
   * Calculate session totals from transactions
   */
  async calculateSessionTotals(sessionId) {
    const transactions = await POSTransaction.find({ 
      session: sessionId,
      status: { $ne: 'voided' }
    });
    
    let totalTransactions = 0;
    let totalSales = 0;
    let totalRefunds = 0;
    let totalDiscounts = 0;
    let totalTax = 0;
    
    const paymentMethods = {
      cash: 0,
      card: 0,
      digital: 0,
      giftCard: 0,
      other: 0
    };
    
    transactions.forEach(transaction => {
      totalTransactions += 1;
      
      if (transaction.type === 'sale') {
        totalSales += transaction.total;
      } else if (transaction.type === 'refund') {
        totalRefunds += Math.abs(transaction.total);
      }
      
      totalDiscounts += transaction.totalDiscount || 0;
      totalTax += transaction.totalTax || 0;
      
      // Aggregate payment methods
      if (transaction.paymentMethod === 'split') {
        transaction.payments.forEach(payment => {
          const method = payment.method === 'gift-card' ? 'giftCard' : payment.method;
          if (paymentMethods.hasOwnProperty(method)) {
            paymentMethods[method] += payment.amount;
          } else {
            paymentMethods.other += payment.amount;
          }
        });
      } else {
        const method = transaction.paymentMethod === 'gift-card' ? 'giftCard' : transaction.paymentMethod;
        if (paymentMethods.hasOwnProperty(method)) {
          paymentMethods[method] += transaction.total;
        } else {
          paymentMethods.other += transaction.total;
        }
      }
    });
    
    return {
      totalTransactions,
      totalSales,
      totalRefunds,
      totalDiscounts,
      totalTax,
      paymentMethods
    };
  }
  
  /**
   * Update session totals after a new transaction
   */
  async updateSessionTotals(sessionId, transaction) {
    const session = await POSSession.findById(sessionId);
    if (!session) return;
    
    session.totalTransactions += 1;
    
    if (transaction.type === 'sale') {
      session.totalSales += transaction.total;
    } else if (transaction.type === 'refund') {
      session.totalRefunds += Math.abs(transaction.total);
    }
    
    session.totalDiscounts += transaction.totalDiscount || 0;
    session.totalTax += transaction.totalTax || 0;
    
    // Update payment method totals
    if (transaction.paymentMethod === 'split') {
      transaction.payments.forEach(payment => {
        const method = payment.method === 'gift-card' ? 'giftCard' : payment.method;
        if (session.paymentMethods.hasOwnProperty(method)) {
          session.paymentMethods[method] += payment.amount;
        } else {
          session.paymentMethods.other += payment.amount;
        }
      });
    } else {
      const method = transaction.paymentMethod === 'gift-card' ? 'giftCard' : transaction.paymentMethod;
      if (session.paymentMethods.hasOwnProperty(method)) {
        session.paymentMethods[method] += transaction.total;
      } else {
        session.paymentMethods.other += transaction.total;
      }
    }
    
    await session.save();
  }
  
  /**
   * Generate detailed session report
   */
  async generateSessionReport(sessionId) {
    const session = await POSSession.findById(sessionId)
      .populate('register', 'name location')
      .populate('openedBy closedBy', 'firstName lastName');
    
    if (!session) {
      throw new Error('Session not found');
    }
    
    const transactions = await POSTransaction.find({ session: sessionId })
      .populate('cashier', 'firstName lastName')
      .populate('items.product', 'name sku')
      .sort({ createdAt: 1 });
    
    // Calculate additional metrics
    const salesTransactions = transactions.filter(t => t.type === 'sale');
    const refundTransactions = transactions.filter(t => t.type === 'refund');
    
    const averageTransaction = session.totalSales / (salesTransactions.length || 1);
    const refundRate = (refundTransactions.length / (salesTransactions.length || 1)) * 100;
    
    // Product performance
    const productSales = {};
    salesTransactions.forEach(transaction => {
      transaction.items.forEach(item => {
        const productId = item.product._id.toString();
        if (!productSales[productId]) {
          productSales[productId] = {
            name: item.productName || item.product.name,
            sku: item.productSku || item.product.sku,
            quantity: 0,
            revenue: 0
          };
        }
        productSales[productId].quantity += item.quantity;
        productSales[productId].revenue += item.totalPrice;
      });
    });
    
    const topProducts = Object.values(productSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
    
    return {
      session,
      transactions,
      summary: {
        totalTransactions: session.totalTransactions,
        salesTransactions: salesTransactions.length,
        refundTransactions: refundTransactions.length,
        totalSales: session.totalSales,
        totalRefunds: session.totalRefunds,
        netSales: session.totalSales - session.totalRefunds,
        totalDiscounts: session.totalDiscounts,
        totalTax: session.totalTax,
        averageTransaction,
        refundRate: parseFloat(refundRate.toFixed(2)),
        variance: session.variance || 0
      },
      paymentMethods: session.paymentMethods,
      topProducts,
      performance: {
        averageTransactionValue: averageTransaction,
        transactionsPerHour: session.duration ? 
          (session.totalTransactions / (session.duration / (1000 * 60 * 60))) : 0,
        discountRate: session.totalSales ? 
          ((session.totalDiscounts / session.totalSales) * 100) : 0
      }
    };
  }
  
  /**
   * Generate sales report with aggregation
   */
  async generateSalesReport(options) {
    const { registerId, dateFrom, dateTo, groupBy = 'day' } = options;
    
    const matchStage = {
      type: 'sale',
      status: { $ne: 'voided' }
    };
    
    if (registerId) {
      matchStage.register = mongoose.Types.ObjectId(registerId);
    }
    
    if (dateFrom || dateTo) {
      matchStage.createdAt = {};
      if (dateFrom) matchStage.createdAt.$gte = new Date(dateFrom);
      if (dateTo) matchStage.createdAt.$lte = new Date(dateTo);
    }
    
    // Determine grouping format
    let groupFormat;
    switch (groupBy) {
      case 'hour':
        groupFormat = { 
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' },
          hour: { $hour: '$createdAt' }
        };
        break;
      case 'day':
        groupFormat = { 
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        };
        break;
      case 'week':
        groupFormat = { 
          year: { $year: '$createdAt' },
          week: { $week: '$createdAt' }
        };
        break;
      case 'month':
        groupFormat = { 
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        };
        break;
      default:
        groupFormat = { 
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
          day: { $dayOfMonth: '$createdAt' }
        };
    }
    
    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: groupFormat,
          totalTransactions: { $sum: 1 },
          totalRevenue: { $sum: '$total' },
          totalDiscounts: { $sum: '$totalDiscount' },
          totalTax: { $sum: '$totalTax' },
          averageTransaction: { $avg: '$total' },
          totalItems: { $sum: { $size: '$items' } }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.hour': 1 } }
    ];
    
    const results = await POSTransaction.aggregate(pipeline);
    
    // Calculate totals
    const totals = results.reduce((acc, curr) => ({
      totalTransactions: acc.totalTransactions + curr.totalTransactions,
      totalRevenue: acc.totalRevenue + curr.totalRevenue,
      totalDiscounts: acc.totalDiscounts + curr.totalDiscounts,
      totalTax: acc.totalTax + curr.totalTax,
      totalItems: acc.totalItems + curr.totalItems
    }), {
      totalTransactions: 0,
      totalRevenue: 0,
      totalDiscounts: 0,
      totalTax: 0,
      totalItems: 0
    });
    
    return {
      data: results,
      totals: {
        ...totals,
        averageTransaction: totals.totalRevenue / (totals.totalTransactions || 1),
        averageItemsPerTransaction: totals.totalItems / (totals.totalTransactions || 1)
      },
      groupBy,
      period: { dateFrom, dateTo }
    };
  }
}

export const posService = new POSService();