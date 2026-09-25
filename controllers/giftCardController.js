import GiftCard from '../models/GiftCard.js';
import Order from '../models/Order.js';
import { sendGiftCardEmail } from '../utils/emailService.js';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../utils/ApiError.js';
import { addDays } from 'date-fns';

// Purchase gift card
export const purchaseGiftCard = async (req, res) => {
  try {
    const {
      amount,
      recipientName,
      recipientEmail,
      message,
      currency = 'USD',
      expiryDate
    } = req.body;

    // Validate amount
    if (!amount || amount < 10) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Gift card amount must be at least $10'
      );
    }

    // Compute expiry: use provided valid date (>= today) else default +365 days
    // Always store as end-of-day UTC to prevent off-by-one in local time zones
    const endOfDayUTC = (date) => {
      const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
      return d;
    };
    const parseExpiryInput = (input) => {
      if (typeof input === 'string') {
        const m = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) {
          const y = Number(m[1]);
          const mo = Number(m[2]) - 1;
          const da = Number(m[3]);
          return new Date(Date.UTC(y, mo, da, 23, 59, 59, 999));
        }
      }
      const d = new Date(input);
      return endOfDayUTC(d);
    };
    let computedExpiry = endOfDayUTC(addDays(new Date(), 365));
    if (expiryDate) {
  const d = parseExpiryInput(expiryDate);
      const today = new Date();
      today.setHours(0,0,0,0);
      if (isNaN(d.getTime())) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          'Invalid expiry date'
        );
      }
  if (d < today) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          'Expiry date must be today or in the future'
        );
      }
  computedExpiry = d;
    }

    // Create gift card
    const giftCard = new GiftCard({
      initialBalance: amount,
      currentBalance: amount,
      currency,
      expiryDate: computedExpiry, // Valid for 1 year by default or custom when provided
      purchasedBy: req.user._id,
      recipient: {
        name: recipientName,
        email: recipientEmail,
        message
      }
    });

  await giftCard.save();
  await giftCard.populate('purchasedBy', 'name email');

  // Respond first to speed up UX
  res.status(StatusCodes.CREATED).json(giftCard);

    // Send email asynchronously; don't block response
    if (recipientEmail) {
      Promise.resolve().then(() =>
        sendGiftCardEmail({
          to: recipientEmail,
          giftCard,
          sender: req.user.name
        })
      ).catch((e) => {
        // Log and continue; do not crash request lifecycle
        console.error('Failed to send gift card email:', e?.message || e);
      });
    }
  } catch (error) {
    throw new ApiError(
      error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

// Check gift card balance
export const checkBalance = async (req, res) => {
  try {
    const { code } = req.params;
    const giftCard = await GiftCard.findOne({ code });

    if (!giftCard) {
      throw new ApiError(
        StatusCodes.NOT_FOUND,
        'Gift card not found'
      );
    }

    // If expired, update status lazily
    const now = new Date();
    if (giftCard.expiryDate && giftCard.expiryDate < now && giftCard.status !== 'expired') {
      giftCard.status = 'expired';
      await giftCard.save();
    }

    res.json({
      code: giftCard.code,
      balance: giftCard.currentBalance,
      currency: giftCard.currency,
      status: giftCard.status,
      expiryDate: giftCard.expiryDate
    });
  } catch (error) {
    throw new ApiError(
      error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

// Apply gift card to order
export const applyToOrder = async (req, res) => {
  try {
    const { code, amount } = req.body;
    const giftCard = await GiftCard.findOne({ code });

    if (!giftCard) {
      throw new ApiError(
        StatusCodes.NOT_FOUND,
        'Gift card not found'
      );
    }

    // Check expiry and update status if needed
    const now = new Date();
    if (giftCard.expiryDate && giftCard.expiryDate < now) {
      if (giftCard.status !== 'expired') {
        giftCard.status = 'expired';
        await giftCard.save();
      }
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Gift card is expired'
      );
    }

    if (giftCard.status !== 'active') {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Gift card is ${giftCard.status}`
      );
    }

    if (giftCard.currentBalance < amount) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Insufficient gift card balance'
      );
    }

    // Update balance
    giftCard.currentBalance -= amount;
    giftCard.lastUsed = new Date();
    giftCard.redemptions.push({
      order: req.body.orderId,
      amount
    });

    await giftCard.save();

    try {
      if (req.body?.orderId) {
        await Order.findByIdAndUpdate(req.body.orderId, {
          giftCard: {
            code,
            amountApplied: amount,
            remainingBalance: giftCard.currentBalance
          }
        });
      }
    } catch (updateErr) {
      console.warn('Failed to update order with gift card info:', updateErr?.message || updateErr);
    }

    res.json({
      amountApplied: amount,
      remainingBalance: giftCard.currentBalance
    });
  } catch (error) {
    throw new ApiError(
      error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

// Apply gift card to order (guest-friendly: validate by orderId + email)
export const applyToOrderGuest = async (req, res) => {
  try {
    const { code, amount, orderId, email } = req.body;

    if (!code || !amount || !orderId || !email) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'code, amount, orderId and email are required');
    }

    const giftCard = await GiftCard.findOne({ code });

    if (!giftCard) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Gift card not found');
    }

    // Check expiry and update status if needed
    const now = new Date();
    if (giftCard.expiryDate && giftCard.expiryDate < now) {
      if (giftCard.status !== 'expired') {
        giftCard.status = 'expired';
        await giftCard.save();
      }
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Gift card is expired');
    }

    if (giftCard.status !== 'active') {
      throw new ApiError(StatusCodes.BAD_REQUEST, `Gift card is ${giftCard.status}`);
    }

    if (giftCard.currentBalance < amount) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Insufficient gift card balance');
    }

    // Validate order by id and customer email (case-insensitive)
    const order = await Order.findOne({ _id: orderId, 'customerInfo.email': new RegExp(`^${email}$`, 'i') });
    if (!order) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Order not found');
    }

    // Deduct and record redemption
    giftCard.currentBalance -= amount;
    giftCard.lastUsed = new Date();
    giftCard.redemptions.push({ order: order._id, amount });
    await giftCard.save();

    try {
      order.giftCard = {
        code,
        amountApplied: amount,
        remainingBalance: giftCard.currentBalance
      };
      await order.save();
    } catch (updateErr) {
      console.warn('Failed to update order gift card snapshot (guest apply):', updateErr?.message || updateErr);
    }

    res.json({ amountApplied: amount, remainingBalance: giftCard.currentBalance });
  } catch (error) {
    throw new ApiError(
      error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};

// Admin: Get all gift cards
export const getAllGiftCards = async (req, res) => {
  try {
    const giftCards = await GiftCard.find()
      .populate('purchasedBy', 'name email')
      .sort('-createdAt');
    
    res.json(giftCards);
  } catch (error) {
    throw new ApiError(
      StatusCodes.INTERNAL_SERVER_ERROR,
      'Failed to fetch gift cards'
    );
  }
};

// Admin: Cancel gift card
export const cancelGiftCard = async (req, res) => {
  try {
    const giftCard = await GiftCard.findById(req.params.id);
    
    if (!giftCard) {
      throw new ApiError(
        StatusCodes.NOT_FOUND,
        'Gift card not found'
      );
    }

    giftCard.status = 'cancelled';
    await giftCard.save();

    res.json({ message: 'Gift card cancelled successfully' });
  } catch (error) {
    throw new ApiError(
      error.statusCode || StatusCodes.INTERNAL_SERVER_ERROR,
      error.message
    );
  }
};