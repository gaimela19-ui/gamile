import asyncHandler from 'express-async-handler';
import { StatusCodes } from 'http-status-codes';
import revenueAnalyticsService from '../services/revenueAnalyticsService.js';
import dataSeeder from '../services/dataSeeder.js';

// @desc Get revenue analytics
// @route GET /api/revenue/analytics
// @access Private
export const getRevenueAnalytics = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  // Default to last 30 days if no dates provided
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  console.log('Revenue analytics request:', { start, end });

  const analytics = await revenueAnalyticsService.getRevenueAnalytics({ start, end });

  res.status(StatusCodes.OK).json({
    success: true,
    data: analytics,
    period: {
      start: start.toISOString(),
      end: end.toISOString(),
      days: Math.ceil((end - start) / (1000 * 60 * 60 * 24))
    }
  });
});

// @desc Get revenue forecast
// @route GET /api/revenue/forecast
// @access Private
export const getRevenueForecast = asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;
  const forecastDays = Math.min(parseInt(days), 90); // Limit to 90 days

  console.log('Revenue forecast request:', { days: forecastDays });

  const forecast = await revenueAnalyticsService.getRevenueForecast(forecastDays);

  res.status(StatusCodes.OK).json({
    success: true,
    data: forecast,
    parameters: {
      forecastDays,
      generatedAt: new Date().toISOString()
    }
  });
});

// @desc Get real-time revenue metrics
// @route GET /api/revenue/realtime
// @access Private
export const getRealTimeRevenue = asyncHandler(async (req, res) => {
  // Get today's metrics for real-time display
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const analytics = await revenueAnalyticsService.getRevenueAnalytics({ 
    start: today, 
    end: tomorrow 
  });

  res.status(StatusCodes.OK).json({
    success: true,
    data: {
      todayRevenue: analytics.summary.todayRevenue,
      totalOrders: analytics.summary.totalOrders,
      averageOrderValue: analytics.summary.averageOrderValue,
      hourlyRevenue: analytics.hourlyRevenue,
      lastUpdated: new Date().toISOString()
    }
  });
});

// @desc Update revenue on new order (for real-time updates)
// @route POST /api/revenue/update-order
// @access Private
export const updateRevenueOnOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.body;

  if (!orderId) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: 'Order ID is required'
    });
  }

  // This would typically be called internally when an order is created/updated
  // For now, we'll return the current real-time metrics
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const analytics = await revenueAnalyticsService.getRevenueAnalytics({ 
    start: today, 
    end: tomorrow 
  });

  res.status(StatusCodes.OK).json({
    success: true,
    data: analytics.summary,
    updatedAt: new Date().toISOString()
  });
});

// @desc Get revenue by category
// @route GET /api/revenue/categories
// @access Private
export const getRevenueByCategoryController = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const analytics = await revenueAnalyticsService.getRevenueAnalytics({ start, end });

  res.status(StatusCodes.OK).json({
    success: true,
    data: {
      categories: analytics.categoryRevenue,
      totalRevenue: analytics.summary.totalRevenue,
      period: {
        start: start.toISOString(),
        end: end.toISOString()
      }
    }
  });
});

// @desc Get top products by revenue
// @route GET /api/revenue/products
// @access Private
export const getTopProductsByRevenue = asyncHandler(async (req, res) => {
  const { startDate, endDate, limit = 10 } = req.query;

  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const analytics = await revenueAnalyticsService.getRevenueAnalytics({ start, end });

  res.status(StatusCodes.OK).json({
    success: true,
    data: {
      products: analytics.topProducts.slice(0, parseInt(limit)),
      totalProducts: analytics.topProducts.length,
      period: {
        start: start.toISOString(),
        end: end.toISOString()
      }
    }
  });
});

// @desc Get revenue trends
// @route GET /api/revenue/trends
// @access Private
export const getRevenueTrends = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const analytics = await revenueAnalyticsService.getRevenueAnalytics({ start, end });

  res.status(StatusCodes.OK).json({
    success: true,
    data: {
      dailyRevenue: analytics.dailyRevenue,
      trends: analytics.trends,
      summary: analytics.summary,
      period: {
        start: start.toISOString(),
        end: end.toISOString()
      }
    }
  });
});

// @desc Seed revenue data for testing
// @route POST /api/revenue/seed
// @access Public
export const seedRevenueData = asyncHandler(async (req, res) => {
  await dataSeeder.seedRevenueData();
  await dataSeeder.seedTodaysOrders();
  
  res.status(StatusCodes.OK).json({
    success: true,
    message: 'Revenue data seeded successfully'
  });
});
