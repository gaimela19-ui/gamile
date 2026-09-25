import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Order from '../models/Order.js';
import { auth } from '../middleware/auth.js';
import { adminAuth } from '../middleware/auth.js';
import * as XLSX from 'xlsx';
import mongoose from 'mongoose';

const router = express.Router();

// Update user profile
router.patch('/profile', auth, async (req, res) => {
  try {
    const {
      name,
      email,
      image,
      phoneNumber,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country
    } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Validate email uniqueness if changed
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: 'Email already in use' });
      }
    }

    const normalizedPhone = typeof phoneNumber === 'string' ? phoneNumber.trim() : phoneNumber;
    if (typeof normalizedPhone === 'string' && normalizedPhone) {
      const existingPhoneUser = await User.findOne({ phoneNumber: normalizedPhone, _id: { $ne: user._id } });
      if (existingPhoneUser) {
        return res.status(400).json({ message: 'Phone number already in use' });
      }
    }

    // Update fields
    if (name) user.name = name;
    if (email) user.email = email;
    if (image) user.image = image;
    if (phoneNumber !== undefined) user.phoneNumber = normalizedPhone || undefined;
    if (addressLine1 !== undefined) user.addressLine1 = String(addressLine1 || '').trim();
    if (addressLine2 !== undefined) user.addressLine2 = String(addressLine2 || '').trim();
    if (city !== undefined) user.city = String(city || '').trim();
    if (state !== undefined) user.state = String(state || '').trim();
    if (postalCode !== undefined) user.postalCode = String(postalCode || '').trim();
    if (country !== undefined) user.country = String(country || '').trim();

    await user.save();

    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        image: user.image,
        phoneNumber: user.phoneNumber || '',
        addressLine1: user.addressLine1 || '',
        addressLine2: user.addressLine2 || '',
        city: user.city || '',
        state: user.state || '',
        postalCode: user.postalCode || '',
        country: user.country || ''
      }
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Update password
router.patch('/password', auth, async (req, res) => {
  try {
    const currentPasswordRaw = String(req.body.currentPassword || '');
    const newPasswordRaw = String(req.body.newPassword || '');
    const currentPasswordTrimmed = currentPasswordRaw.trim();
    const newPasswordTrimmed = newPasswordRaw.trim();

    if (!currentPasswordTrimmed || !newPasswordTrimmed) {
      return res.status(400).json({ message: 'Both current and new password are required' });
    }
    if (newPasswordTrimmed.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify current password (accepting accidental leading/trailing spaces)
    let isMatch = await user.comparePassword(currentPasswordRaw);
    if (!isMatch && currentPasswordTrimmed !== currentPasswordRaw) {
      isMatch = await user.comparePassword(currentPasswordTrimmed);
    }
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    // Update password
    user.password = newPasswordTrimmed;
    await user.save();

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Password update error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Delete account
router.delete('/account', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Anonymize or remove personal data from related records before removing the user
    try {
      // Orders: detach user and scrub PII in customerInfo and shippingAddress
      const scrubbedCustomerInfo = {
        firstName: 'Deleted',
        lastName: 'User',
        email: null,
        mobile: null,
      };
      const scrubbedShipping = {
        street: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
      };
      await Order.updateMany(
        { $or: [ { user: user._id }, { 'customerInfo.email': user.email } ] },
        { $set: { user: null, customerInfo: scrubbedCustomerInfo, shippingAddress: scrubbedShipping } }
      );
    } catch (e) {
      console.warn('Order anonymization failed:', e?.message || e);
    }

    try {
      // Product reviews: remove reviews authored by this user
      const Product = (await import('../models/Product.js')).default;
      await Product.updateMany(
        { 'reviews.user': user._id },
        { $pull: { reviews: { user: user._id } } }
      );
    } catch (e) {
      console.warn('Review cleanup failed:', e?.message || e);
    }

    // Finally remove the user document
    await user.remove();
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Update notification preferences
router.patch('/notifications', auth, async (req, res) => {
  try {
    const { preferences } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.notificationPreferences = {
      ...user.notificationPreferences,
      ...preferences
    };

    await user.save();
    res.json({ preferences: user.notificationPreferences });
  } catch (error) {
    console.error('Notification preferences update error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Get user reviews
router.get('/reviews', auth, async (req, res) => {
  try {
    const Product = (await import('../models/Product.js')).default;
    
    const products = await Product.find({
      'reviews.user': req.user._id
    }).populate({
      path: 'reviews.user',
      select: 'name email image'
    }).select('name images reviews');

    const userReviews = products.reduce((allReviews, product) => {
      const productReviews = product.reviews
        .filter(review => review.user._id.toString() === req.user._id.toString())
        .map(review => ({
          ...review.toObject(),
          product: {
            _id: product._id,
            name: product.name,
            images: product.images
          }
        }));
      return [...allReviews, ...productReviews];
    }, []);

    // Sort by creation date (newest first)
    userReviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(userReviews);
  } catch (error) {
    console.error('Error fetching user reviews:', error);
    res.status(500).json({ message: 'Failed to fetch reviews' });
  }
});

// Admin: list users with simple pagination & search
router.get('/', adminAuth, async (req, res) => {
  try {
    console.log('GET /api/users listing request query=', req.query, 'user=', req.user?._id);
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const search = (req.query.search || '').trim();
    const role = (req.query.role || '').trim();
    const productName = (req.query.productName || '').trim();
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
  const minOrders = req.query.minOrders ? parseInt(req.query.minOrders) : null;
  const maxOrders = req.query.maxOrders ? parseInt(req.query.maxOrders) : null;
  const sortBy = ['createdAt','orderCount','totalSpent','averageOrderValue','lastOrder'].includes(req.query.sortBy) ? req.query.sortBy : 'createdAt';
  const sortDir = req.query.sortDir === 'asc' ? 1 : -1;

  const baseMatch = {};
  const waOptInRaw = (req.query.waOptIn || '').toString().trim().toLowerCase();
  if (waOptInRaw === 'true') baseMatch.whatsappOptIn = true;
  else if (waOptInRaw === 'false') baseMatch.whatsappOptIn = false;
    if (search) {
      baseMatch.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    if (role) {
      baseMatch.role = role;
    }
    // Filter by product purchased: find user IDs from orders containing the product name
    if (productName) {
      const matchingOrders = await Order.find(
        { 'items.name': { $regex: productName, $options: 'i' } },
        { user: 1, 'customerInfo.email': 1 }
      ).lean();
      const userObjectIds = matchingOrders
        .map(o => o.user)
        .filter(id => id && mongoose.Types.ObjectId.isValid(id));
      // Also collect emails for guest orders
      const guestEmails = matchingOrders
        .map(o => o.customerInfo?.email)
        .filter(Boolean)
        .map(e => e.toLowerCase());
      const userIdSet = Array.from(new Set(userObjectIds.map(id => id.toString())));
      const emailSet = Array.from(new Set(guestEmails));
      const productFilter = [];
      if (userIdSet.length) productFilter.push({ _id: { $in: userIdSet.map(id => new mongoose.Types.ObjectId(id)) } });
      if (emailSet.length) productFilter.push({ email: { $in: emailSet.map(e => new RegExp(`^${e}$`, 'i')) } });
      if (!productFilter.length) {
        // No orders found for this product — return empty result fast
        return res.json({ users: [], page: 1, totalPages: 0, total: 0 });
      }
      if (baseMatch.$or) {
        baseMatch.$and = [{ $or: baseMatch.$or }, { $or: productFilter }];
        delete baseMatch.$or;
      } else {
        baseMatch.$or = productFilter;
      }
    }
    if (startDate || endDate) {
      baseMatch.createdAt = {};
      if (startDate) baseMatch.createdAt.$gte = startDate;
      if (endDate) {
        // include entire end day
        const endInclusive = new Date(endDate);
        endInclusive.setHours(23,59,59,999);
        baseMatch.createdAt.$lte = endInclusive;
      }
    }

    const skip = (page - 1) * limit;

    // Build segments for reuse
    const statsLookup = {
      $lookup: {
        from: 'orders',
        let: { userId: '$_id', userEmail: { $toLower: '$email' } },
        pipeline: [
          { $match: { $expr: { $or: [
            { $eq: ['$user', '$$userId'] },
            { $eq: [{ $toLower: '$customerInfo.email' }, '$$userEmail'] }
          ] } } },
          { $group: { _id: null, count: { $sum: 1 }, totalSpent: { $sum: '$totalAmount' }, lastOrder: { $max: '$createdAt' } } }
        ],
        as: 'orderStats'
      }
    };
    const addStats = {
      $addFields: {
        orderCount: { $ifNull: [ { $arrayElemAt: ['$orderStats.count', 0] }, 0 ] },
        totalSpent: { $ifNull: [ { $arrayElemAt: ['$orderStats.totalSpent', 0] }, 0 ] },
        lastOrder: { $arrayElemAt: ['$orderStats.lastOrder', 0] },
        averageOrderValue: { $cond: [ { $gt: [ { $ifNull: [ { $arrayElemAt: ['$orderStats.count', 0] }, 0 ] }, 0 ] }, { $divide: [ { $ifNull: [ { $arrayElemAt: ['$orderStats.totalSpent', 0] }, 0 ] }, { $ifNull: [ { $arrayElemAt: ['$orderStats.count', 0] }, 1 ] } ] }, 0 ] }
      }
    };
    const matchOrderRange = { $match: {
      ...(minOrders !== null ? { orderCount: { $gte: minOrders } } : {}),
      ...(maxOrders !== null ? { ...(minOrders !== null ? {} : { orderCount: {} }), orderCount: { ...(minOrders !== null ? { $gte: minOrders } : {}), $lte: maxOrders } } : {})
    }};

    // Because building dynamic $match with optional min/max is a bit messy above, refine:
    if (minOrders !== null || maxOrders !== null) {
      const range = {};
      if (minOrders !== null) range.$gte = minOrders;
      if (maxOrders !== null) range.$lte = maxOrders;
      matchOrderRange.$match.orderCount = range;
    } else {
      delete matchOrderRange.$match.orderCount;
    }

    const sortStage = { $sort: { [sortBy]: sortDir, _id: 1 } };

    const basePipeline = [
      { $match: baseMatch },
      statsLookup,
      addStats,
      ...( (minOrders !== null || maxOrders !== null) ? [matchOrderRange] : []),
    { $project: { name:1, email:1, role:1, createdAt:1, image:1, orderCount:1, totalSpent:1, lastOrder:1, averageOrderValue:1, phoneNumber:1, whatsappOptIn:1, lastWhatsAppContactAt:1, lastWhatsAppMessagePreview:1 } },
      sortStage
    ];

    const paginatedPipeline = [ ...basePipeline, { $skip: skip }, { $limit: limit } ];

    const [users, countResult] = await Promise.all([
      User.aggregate(paginatedPipeline),
      User.aggregate([ ...basePipeline, { $count: 'total' } ])
    ]);
    const total = countResult[0]?.total || 0;

    res.json({
      users,
      page,
      totalPages: Math.ceil(total / limit),
      total
    });
  } catch (error) {
    console.error('Error listing users:', error);
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

// Admin: export users as CSV (optionally filtered by search)
router.get('/export', adminAuth, async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    const role = (req.query.role || '').trim();
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
  const minOrders = req.query.minOrders ? parseInt(req.query.minOrders) : null;
  const maxOrders = req.query.maxOrders ? parseInt(req.query.maxOrders) : null;
  const sortBy = ['createdAt','orderCount','totalSpent','averageOrderValue','lastOrder'].includes(req.query.sortBy) ? req.query.sortBy : 'createdAt';
  const sortDir = req.query.sortDir === 'asc' ? 1 : -1;
  const userIdsRaw = req.query.userIds;
  const userIdsParam = Array.isArray(userIdsRaw) ? userIdsRaw.join(',') : (userIdsRaw || '').toString().trim();
    const match = {};
    if (search) {
      match.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    if (role) match.role = role;
    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = startDate;
      if (endDate) {
        const endInclusive = new Date(endDate);
        endInclusive.setHours(23,59,59,999);
        match.createdAt.$lte = endInclusive;
      }
    }
    if (userIdsParam) {
      const ids = userIdsParam.split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length) {
        const objectIds = ids.map(id => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);
        match._id = { $in: objectIds };
        console.debug('[users/export] Filtering by userIds:', ids.length);
      }
    }

    const statsLookup = {
      $lookup: {
        from: 'orders',
        let: { userId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$user', '$$userId'] } } },
          { $group: { _id: null, count: { $sum: 1 }, totalSpent: { $sum: '$totalAmount' }, lastOrder: { $max: '$createdAt' } } }
        ],
        as: 'orderStats'
      }
    };
    const addStats = { $addFields: {
      orderCount: { $ifNull: [ { $arrayElemAt: ['$orderStats.count', 0] }, 0 ] },
      totalSpent: { $ifNull: [ { $arrayElemAt: ['$orderStats.totalSpent', 0] }, 0 ] },
      lastOrder: { $arrayElemAt: ['$orderStats.lastOrder', 0] },
      averageOrderValue: { $cond: [ { $gt: [ { $ifNull: [ { $arrayElemAt: ['$orderStats.count', 0] }, 0 ] }, 0 ] }, { $divide: [ { $ifNull: [ { $arrayElemAt: ['$orderStats.totalSpent', 0] }, 0 ] }, { $ifNull: [ { $arrayElemAt: ['$orderStats.count', 0] }, 1 ] } ] }, 0 ] }
    } };
    const rangeMatch = (minOrders !== null || maxOrders !== null) ? (() => { const r = {}; if (minOrders !== null) r.$gte = minOrders; if (maxOrders !== null) r.$lte = maxOrders; return { $match: { orderCount: r } }; })() : null;
    const sortStage = { $sort: { [sortBy]: sortDir, _id: 1 } };
  // Add optional waOptIn filter for export
  const waOptInRaw = (req.query.waOptIn || '').toString().trim().toLowerCase();
  if (waOptInRaw === 'true') match.whatsappOptIn = true;
  else if (waOptInRaw === 'false') match.whatsappOptIn = false;
  const pipeline = [ { $match: match }, statsLookup, addStats, ...(rangeMatch ? [rangeMatch] : []), { $project: { name:1, email:1, role:1, createdAt:1, orderCount:1, totalSpent:1, lastOrder:1, averageOrderValue:1, phoneNumber:1, whatsappOptIn:1, lastWhatsAppContactAt:1, lastWhatsAppMessagePreview:1 } }, sortStage ];
    const users = await User.aggregate(pipeline);

  const header = ['Name', 'Email', 'Role', 'Phone', 'WA Opt-In', 'Last WA Contact', 'WA Preview', 'Created At', 'Order Count', 'Total Spent', 'Avg Order Value', 'Last Order'];
    const rows = users.map(u => [
      (u.name || '').replace(/"/g, '""'),
      (u.email || '').replace(/"/g, '""'),
      (u.role || '').replace(/"/g, '""'),
      (u.phoneNumber || '').replace(/"/g, '""'),
      u.whatsappOptIn ? 'yes' : 'no',
  u.lastWhatsAppContactAt ? new Date(u.lastWhatsAppContactAt).toISOString() : '',
  (u.lastWhatsAppMessagePreview || '').replace(/"/g, '""'),
  u.createdAt?.toISOString() || '',
      String(u.orderCount || 0),
      String(u.totalSpent || 0),
      String(u.averageOrderValue || 0),
      u.lastOrder ? new Date(u.lastOrder).toISOString() : ''
    ]);
    const csv = [header, ...rows].map(r => r.map(field => `"${field}"`).join(',')).join('\n');

    const filename = `customers_export_${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting users:', error);
    res.status(500).json({ message: 'Failed to export users' });
  }
});

// Admin: export users as XLSX
router.get('/export.xlsx', adminAuth, async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    const role = (req.query.role || '').trim();
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    const minOrders = req.query.minOrders ? parseInt(req.query.minOrders) : null;
    const maxOrders = req.query.maxOrders ? parseInt(req.query.maxOrders) : null;
  const sortBy = ['createdAt','orderCount','totalSpent','averageOrderValue','lastOrder'].includes(req.query.sortBy) ? req.query.sortBy : 'createdAt';
    const sortDir = req.query.sortDir === 'asc' ? 1 : -1;
  const userIdsRaw = req.query.userIds;
  const userIdsParam = Array.isArray(userIdsRaw) ? userIdsRaw.join(',') : (userIdsRaw || '').toString().trim();

  const match = {};
    if (search) {
      match.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    if (role) match.role = role;
    if (startDate || endDate) {
  match.createdAt = {};
      if (startDate) match.createdAt.$gte = startDate;
      if (endDate) { const endInclusive = new Date(endDate); endInclusive.setHours(23,59,59,999); match.createdAt.$lte = endInclusive; }
    }
    if (userIdsParam) {
      const ids = userIdsParam.split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length) {
        const objectIds = ids.map(id => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);
        match._id = { $in: objectIds };
        console.debug('[users/export.xlsx] Filtering by userIds:', ids.length);
      }
    }

    const statsLookup = {
      $lookup: {
        from: 'orders',
        let: { userId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$user', '$$userId'] } } },
          { $group: { _id: null, count: { $sum: 1 }, totalSpent: { $sum: '$totalAmount' }, lastOrder: { $max: '$createdAt' } } }
        ],
        as: 'orderStats'
      }
    };
    const addStats = { $addFields: {
      orderCount: { $ifNull: [ { $arrayElemAt: ['$orderStats.count', 0] }, 0 ] },
      totalSpent: { $ifNull: [ { $arrayElemAt: ['$orderStats.totalSpent', 0] }, 0 ] },
      lastOrder: { $arrayElemAt: ['$orderStats.lastOrder', 0] }
    } };
  const rangeMatch = (minOrders !== null || maxOrders !== null) ? (() => { const r = {}; if (minOrders !== null) r.$gte = minOrders; if (maxOrders !== null) r.$lte = maxOrders; return { $match: { orderCount: r } }; })() : null;
    const sortStage = { $sort: { [sortBy]: sortDir, _id: 1 } };
  const pipeline = [ { $match: match }, statsLookup, addStats, ...(rangeMatch ? [rangeMatch] : []), { $project: { name:1, email:1, role:1, createdAt:1, orderCount:1, totalSpent:1, lastOrder:1, averageOrderValue:1, phoneNumber:1, whatsappOptIn:1, lastWhatsAppContactAt:1, lastWhatsAppMessagePreview:1 } }, sortStage ];
    const users = await User.aggregate(pipeline);

    const rows = users.map(u => ({
      Name: u.name || '',
      Email: u.email || '',
      Role: u.role || '',
      Phone: u.phoneNumber || '',
      'WA Opt-In': u.whatsappOptIn ? 'yes':'no',
      'Last WA Contact': u.lastWhatsAppContactAt ? new Date(u.lastWhatsAppContactAt).toISOString() : '',
      'WA Preview': u.lastWhatsAppMessagePreview || '',
      'Created At': u.createdAt ? new Date(u.createdAt).toISOString() : '',
      'Order Count': u.orderCount || 0,
      'Total Spent': u.totalSpent || 0,
      'Avg Order Value': u.averageOrderValue || 0,
      'Last Order': u.lastOrder ? new Date(u.lastOrder).toISOString() : ''
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Customers');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `customers_export_${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(buffer);
  } catch (error) {
    console.error('Error exporting XLSX users:', error);
    res.status(500).json({ message: 'Failed to export users XLSX' });
  }
});

// Admin: summary stats for dashboard (total customers, new this period, top spenders)
router.get('/stats/summary', adminAuth, async (req, res) => {
  try {
    const periodDays = Math.min(parseInt(req.query.days) || 30, 365);
    const since = new Date();
    since.setDate(since.getDate() - periodDays);

    const [totalCustomers, newCustomers, orderAgg] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ createdAt: { $gte: since } }),
      Order.aggregate([
        { $group: { _id: '$user', orderCount: { $sum: 1 }, totalSpent: { $sum: '$totalAmount' }, lastOrder: { $max: '$createdAt' } } },
        { $sort: { totalSpent: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        { $project: { _id: 0, userId: '$user._id', name: '$user.name', email: '$user.email', orderCount:1, totalSpent:1, lastOrder:1 } }
      ])
    ]);

    res.json({
      totalCustomers,
      newCustomersPeriod: periodDays,
      newCustomers,
      topSpenders: orderAgg
    });
  } catch (error) {
    console.error('Error fetching customer summary stats:', error);
    res.status(500).json({ message: 'Failed to fetch customer stats' });
  }
});

// Admin: bulk delete users  — must be BEFORE /:id routes
router.delete('/bulk', adminAuth, async (req, res) => {
  try {
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ message: 'userIds array required' });
    }
    // Prevent self-deletion
    const filteredIds = userIds.filter(id => id !== req.user._id.toString());
    const result = await User.deleteMany({ _id: { $in: filteredIds } });
    res.json({ message: 'Users deleted', deletedCount: result.deletedCount });
  } catch (error) {
    console.error('Error bulk deleting users:', error);
    res.status(500).json({ message: 'Failed to bulk delete users' });
  }
});

// Admin: get specific user's recent orders
router.get('/:id/orders', adminAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const userId = req.params.id;
    const u = await User.findById(userId).select('email').lean();
    const query = u?.email
      ? { $or: [{ user: userId }, { 'customerInfo.email': new RegExp(`^${u.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }] }
      : { user: userId };
    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('orderNumber totalAmount currency status paymentStatus createdAt items');
    res.json(orders);
  } catch (error) {
    console.error('Error fetching user orders:', error);
    res.status(500).json({ message: 'Failed to fetch user orders' });
  }
});

// Admin: update a user's role
router.patch('/:id/role', adminAuth, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user','admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ message: 'User not found' });
    if (u._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot change your own role' });
    }
    u.role = role;
    await u.save();
    res.json({ message: 'Role updated', user: { id: u._id, role: u.role } });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ message: 'Failed to update role' });
  }
});

// Admin: bulk role update
router.patch('/bulk-role', adminAuth, async (req, res) => {
  try {
    const { userIds, role } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ message: 'userIds array required' });
    }
    if (!['user','admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }
    // Prevent self change through bulk
    const filteredIds = userIds.filter(id => id !== req.user._id.toString());
    const result = await User.updateMany({ _id: { $in: filteredIds } }, { $set: { role } });
    res.json({ message: 'Roles updated', modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error('Error bulk updating roles:', error);
    res.status(500).json({ message: 'Failed to bulk update roles' });
  }
});

// Admin: update contact info (phone / whatsapp opt-in)
router.patch('/:id/contact', adminAuth, async (req, res) => {
  try {
    const { phoneNumber, whatsappOptIn } = req.body;
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ message: 'User not found' });
    if (typeof phoneNumber !== 'undefined') u.phoneNumber = phoneNumber || null;
    if (typeof whatsappOptIn !== 'undefined') u.whatsappOptIn = !!whatsappOptIn;
    await u.save();
    res.json({ message: 'Contact updated', user: { id: u._id, phoneNumber: u.phoneNumber, whatsappOptIn: u.whatsappOptIn } });
  } catch (error) {
    console.error('Error updating contact info:', error);
    res.status(500).json({ message: 'Failed to update contact info' });
  }
});

export default router;