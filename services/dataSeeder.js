import Order from '../models/Order.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import { createTestDeliveryCompany } from '../utils/createTestData.js';

class DataSeeder {
  async seedRevenueData() {
    try {
      console.log('Revenue data seeding disabled to prevent demo data');
      return; // Early return to disable seeding

      // Check if we already have orders
      const existingOrders = await Order.countDocuments();
      if (existingOrders > 10) {
        console.log('Sufficient order data already exists');
        return;
      }

      // Get or create sample products
      const products = await this.getOrCreateSampleProducts();
      
      // Get or create sample user
      const user = await this.getOrCreateSampleUser();

      // Generate sample orders for the last 90 days
      const orders = [];
      const now = new Date();
      
      for (let i = 0; i < 90; i++) {
        const orderDate = new Date(now);
        orderDate.setDate(orderDate.getDate() - i);
        
        // Generate 1-5 orders per day with varying amounts
        const ordersPerDay = Math.floor(Math.random() * 5) + 1;
        
        for (let j = 0; j < ordersPerDay; j++) {
          const orderItems = this.generateOrderItems(products);
          const totalAmount = orderItems.reduce((sum, item) => sum + (item.quantity * item.price), 0);
          
          const order = {
            orderNumber: `ORD${Date.now()}${Math.random().toString(36).substr(2, 9)}`,
            user: user._id,
            customerInfo: {
              firstName: 'John',
              lastName: 'Doe',
              email: 'john.doe@example.com',
              mobile: '+1234567890'
            },
            items: orderItems,
            totalAmount: totalAmount,
            status: this.getRandomOrderStatus(),
            shippingAddress: {
              street: '123 Main St',
              city: 'Anytown',
              state: 'ST',
              zipCode: '12345',
              country: 'JO'
            },
            paymentMethod: 'card',
            createdAt: orderDate,
            updatedAt: orderDate
          };
          
          orders.push(order);
        }
      }

      // Insert orders in batches
      await Order.insertMany(orders);
      console.log(`Seeded ${orders.length} sample orders for revenue analytics`);

    } catch (error) {
      console.error('Error seeding revenue data:', error);
      throw error;
    }
  }

  async getOrCreateSampleProducts() {
    let products = await Product.find().limit(10);
    
    // Commented out sample product creation to prevent demo data seeding
    // if (products.length < 5) {
    //   // Sample product creation disabled
    // }

    return products;
  }

  async getOrCreateSampleUser() {
    // Commented out sample user creation to prevent demo data
    // let user = await User.findOne({ email: 'sample@example.com' });
    
    // Return null if no sample user needed
    return null;
  }

  generateOrderItems(products) {
    const numItems = Math.floor(Math.random() * 3) + 1; // 1-3 items per order
    const selectedProducts = products.sort(() => 0.5 - Math.random()).slice(0, numItems);
    
    return selectedProducts.map(product => ({
      product: product._id,
      quantity: Math.floor(Math.random() * 3) + 1, // 1-3 quantity
      price: product.price
    }));
  }

  getRandomOrderStatus() {
    const statuses = ['delivered', 'processing', 'shipped', 'pending'];
    return statuses[Math.floor(Math.random() * statuses.length)];
  }

  // Method to seed today's orders for real-time testing
  async seedTodaysOrders() {
    try {
      const products = await Product.find().limit(5);
      const user = await this.getOrCreateSampleUser();
      
      if (products.length === 0) {
        console.log('No products available for seeding today\'s orders');
        return;
      }

      const today = new Date();
      const orders = [];

      // Create 3-5 orders for today at different hours
      for (let i = 0; i < 5; i++) {
        const orderTime = new Date(today);
        orderTime.setHours(9 + i * 2, Math.floor(Math.random() * 60), 0, 0);

        const orderItems = this.generateOrderItems(products);
        const totalAmount = orderItems.reduce((sum, item) => sum + (item.quantity * item.price), 0);

        const order = {
          orderNumber: `TODAY${Date.now()}${Math.random().toString(36).substr(2, 9)}`,
          user: user._id,
          customerInfo: {
            firstName: 'Today',
            lastName: 'Customer',
            email: 'today@example.com',
            mobile: '+1234567890'
          },
          items: orderItems,
          totalAmount: totalAmount,
          status: 'delivered',
          shippingAddress: {
            street: '123 Main St',
            city: 'Anytown',
            state: 'ST',
            zipCode: '12345',
            country: 'JO'
          },
          paymentMethod: 'card',
          createdAt: orderTime,
          updatedAt: orderTime
        };

        orders.push(order);
      }

      await Order.insertMany(orders);
      console.log(`Seeded ${orders.length} orders for today`);

    } catch (error) {
      console.error('Error seeding today\'s orders:', error);
      throw error;
    }
  }

  async seedDeliveryCompanies() {
    try {
      console.log('🚚 Seeding test delivery company...');
      await createTestDeliveryCompany();
      console.log('✅ Test delivery company seeded successfully');
    } catch (error) {
      console.error('❌ Error seeding delivery companies:', error);
      throw error;
    }
  }
}

export default new DataSeeder();
