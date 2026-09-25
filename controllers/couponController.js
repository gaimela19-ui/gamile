import Coupon from '../models/Coupon.js';
import { StatusCodes } from 'http-status-codes';

export const createCoupon = async (req, res) => {
  try {
    const coupon = new Coupon(req.body);
    await coupon.save();
    res.status(StatusCodes.CREATED).json(coupon);
  } catch (error) {
    res.status(StatusCodes.BAD_REQUEST).json({ message: error.message });
  }
};

export const getAllCoupons = async (req, res) => {
  try {
    const coupons = await Coupon.find()
      .populate('categories', 'name')
      .populate('products', 'name')
      .sort('-createdAt');
    res.json(coupons);
  } catch (error) {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: error.message });
  }
};

export const getCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id)
      .populate('categories', 'name')
      .populate('products', 'name');
    
    if (!coupon) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: 'Coupon not found' });
    }
    
    res.json(coupon);
  } catch (error) {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: error.message });
  }
};

export const updateCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!coupon) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: 'Coupon not found' });
    }
    
    res.json(coupon);
  } catch (error) {
    res.status(StatusCodes.BAD_REQUEST).json({ message: error.message });
  }
};

export const deleteCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    
    if (!coupon) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: 'Coupon not found' });
    }
    
    res.json({ message: 'Coupon deleted successfully' });
  } catch (error) {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: error.message });
  }
};

export const validateCoupon = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Please login to use coupons' });
    }
    // Support both POST body and optional GET query fallback
    const codeRaw = (req.body?.code || req.query?.code || '').toString();
    const totalAmountRaw = req.body?.totalAmount ?? req.query?.totalAmount ?? 0;
    const totalAmount = Number(totalAmountRaw) || 0;

    if (!codeRaw) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Coupon code is required' });
    }

    const code = codeRaw.toUpperCase();
    const now = new Date();
    const coupon = await Coupon.findOne({
      code,
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now }
    });

    if (!coupon) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: 'Invalid or expired coupon code' });
    }

    if (totalAmount < coupon.minPurchase) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: `Minimum purchase amount of $${coupon.minPurchase} required` });
    }

    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      return res.status(StatusCodes.BAD_REQUEST).json({ message: 'Coupon usage limit reached' });
    }

    let discount = 0;
    if (coupon.type === 'percentage') {
      discount = (totalAmount * coupon.value) / 100;
      if (coupon.maxDiscount) {
        discount = Math.min(discount, coupon.maxDiscount);
      }
    } else {
      discount = coupon.value;
    }

    res.json({ coupon, discount: Number(discount.toFixed(2)) });
  } catch (error) {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: error.message });
  }
};

export const applyCoupon = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(StatusCodes.UNAUTHORIZED).json({ message: 'Please login to use coupons' });
    }
    const { code } = req.params;
    const coupon = await Coupon.findOne({ code: code.toUpperCase() });
    
    if (!coupon) {
      return res.status(StatusCodes.NOT_FOUND).json({ message: 'Coupon not found' });
    }

    // Increment usage count
    coupon.usedCount += 1;
    await coupon.save();

    res.json({ message: 'Coupon applied successfully' });
  } catch (error) {
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ message: error.message });
  }
};