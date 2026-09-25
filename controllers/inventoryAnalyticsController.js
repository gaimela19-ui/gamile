import asyncHandler from 'express-async-handler';
import { inventoryAnalyticsService } from '../services/inventoryAnalyticsService.js';
import { StatusCodes } from 'http-status-codes';

export const getInventoryAnalytics = asyncHandler(async (req, res) => {
  console.log('getInventoryAnalytics called with query:', req.query);
  const { startDate, endDate } = req.query;
  
  // Handle missing date parameters
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(endDate) : new Date();
  
  console.log('Date range:', { start, end });
  
  const analytics = await inventoryAnalyticsService.getAnalytics({
    start,
    end
  });
  
  console.log('Analytics result:', analytics);
  res.status(StatusCodes.OK).json(analytics);
});

export const getStockMovements = asyncHandler(async (req, res) => {
  console.log('getStockMovements called with query:', req.query);
  const { startDate, endDate, limit } = req.query;
  
  // Handle missing date parameters
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(endDate) : new Date();
  
  console.log('Date range for movements:', { start, end });
  
  const movements = await inventoryAnalyticsService.getStockMovements({
    start,
    end,
    limit: limit ? Number(limit) : undefined
  });
  
  console.log('Movements result:', movements);
  res.status(StatusCodes.OK).json(movements);
});

export const getTurnoverAnalysis = asyncHandler(async (req, res) => {
  console.log('getTurnoverAnalysis called with query:', req.query);
  const { startDate, endDate, limit } = req.query;
  
  // Handle missing date parameters
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(endDate) : new Date();
  
  console.log('Date range for turnover:', { start, end });
  
  const turnover = await inventoryAnalyticsService.getTurnoverAnalysis({
    start,
    end,
    limit: limit ? Number(limit) : undefined
  });
  
  console.log('Turnover result:', turnover);
  res.status(StatusCodes.OK).json(turnover);
});

export const getCategoryBreakdown = asyncHandler(async (req, res) => {
  console.log('getCategoryBreakdown called with query:', req.query);
  const { startDate, endDate } = req.query;
  
  // Handle missing date parameters
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(endDate) : new Date();
  
  console.log('Date range for categories:', { start, end });
  
  const categories = await inventoryAnalyticsService.getCategoryBreakdown({
    start,
    end
  });
  
  console.log('Categories result:', categories);
  res.status(StatusCodes.OK).json(categories);
});

export const getLocationAnalysis = asyncHandler(async (req, res) => {
  console.log('getLocationAnalysis called with query:', req.query);
  const { startDate, endDate } = req.query;
  
  // Handle missing date parameters
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(endDate) : new Date();
  
  console.log('Date range for locations:', { start, end });
  
  const locations = await inventoryAnalyticsService.getLocationAnalysis({
    start,
    end
  });
  
  console.log('Locations result:', locations);
  res.status(StatusCodes.OK).json(locations);
});

export const getInventoryAlerts = asyncHandler(async (req, res) => {
  console.log('getInventoryAlerts called');
  const alerts = await inventoryAnalyticsService.getAlerts();
  console.log('Alerts result:', alerts);
  res.status(StatusCodes.OK).json(alerts);
});

export const exportInventoryAnalytics = asyncHandler(async (req, res) => {
  const { startDate, endDate, format = 'excel' } = req.query;
  const data = await inventoryAnalyticsService.exportAnalytics({
    start: new Date(startDate),
    end: new Date(endDate),
    format
  });
  
  const filename = `inventory-analytics-${new Date().toISOString().split('T')[0]}.${format === 'excel' ? 'xlsx' : 'csv'}`;
  
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  res.setHeader('Content-Type', format === 'excel' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv');
  res.send(data);
});

// NEW ENHANCED ANALYTICS ENDPOINTS

export const getPredictiveAnalytics = asyncHandler(async (req, res) => {
  console.log('getPredictiveAnalytics called with query:', req.query);
  const { startDate, endDate } = req.query;
  
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days default
  const end = endDate ? new Date(endDate) : new Date();
  
  console.log('Date range for predictive analytics:', { start, end });
  
  const predictive = await inventoryAnalyticsService.getPredictiveAnalytics({
    start,
    end
  });
  
  console.log('Predictive analytics result:', predictive);
  res.status(StatusCodes.OK).json(predictive);
});

export const getSeasonalAnalysis = asyncHandler(async (req, res) => {
  console.log('getSeasonalAnalysis called with query:', req.query);
  const { startDate, endDate } = req.query;
  
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1 year default
  const end = endDate ? new Date(endDate) : new Date();
  
  console.log('Date range for seasonal analysis:', { start, end });
  
  const seasonal = await inventoryAnalyticsService.getSeasonalAnalysis({
    start,
    end
  });
  
  console.log('Seasonal analysis result:', seasonal);
  res.status(StatusCodes.OK).json(seasonal);
});

export const getCostAnalysis = asyncHandler(async (req, res) => {
  console.log('getCostAnalysis called');
  
  const costAnalysis = await inventoryAnalyticsService.getCostAnalysis({});
  
  console.log('Cost analysis result:', costAnalysis);
  res.status(StatusCodes.OK).json(costAnalysis);
});

export const getSupplierPerformance = asyncHandler(async (req, res) => {
  console.log('getSupplierPerformance called with query:', req.query);
  const { startDate, endDate } = req.query;
  
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days default
  const end = endDate ? new Date(endDate) : new Date();
  
  console.log('Date range for supplier performance:', { start, end });
  
  const suppliers = await inventoryAnalyticsService.getSupplierPerformance({
    start,
    end
  });
  
  console.log('Supplier performance result:', suppliers);
  res.status(StatusCodes.OK).json(suppliers);
});

export const getAdvancedMetrics = asyncHandler(async (req, res) => {
  console.log('getAdvancedMetrics called with query:', req.query);
  const { startDate, endDate } = req.query;
  
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days default
  const end = endDate ? new Date(endDate) : new Date();
  
  console.log('Date range for advanced metrics:', { start, end });
  
  const metrics = await inventoryAnalyticsService.getAdvancedMetrics({
    start,
    end
  });
  
  console.log('Advanced metrics result:', metrics);
  res.status(StatusCodes.OK).json(metrics);
});
