import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import GiftCard from '../models/GiftCard.js';
import PaymentSession from '../models/PaymentSession.js';
import { inventoryService } from './inventoryService.js';

function normalizeCoupon(session) {
  if (!session?.coupon?.code) return undefined;
  const discount = Math.max(0, Number(session.coupon.discount) || 0);
  return { code: session.coupon.code, discount };
}

function buildOrderNumber(session, override) {
  if (override) return override;
  if (session?.orderNumber) return session.orderNumber;
  if (session?.reference) return session.reference;
  return `ORD${Date.now()}`;
}

async function buildOrderItems(session) {
  const items = [];
  const reservations = [];
  let total = 0;

  for (const item of session.items || []) {
    const productId = item?.product;
    const product = await Product.findById(productId);
    if (!product) {
      throw new Error(`Product not found: ${productId}`);
    }
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) {
      throw new Error('invalid_quantity');
    }
    const price = Number(product.price);
    if (!Number.isFinite(price)) {
      throw new Error(`Invalid price for product ${product._id}`);
    }
    total += price * qty;
    const orderItem = {
      product: product._id,
      quantity: qty,
      price,
      name: product.name,
      image: Array.isArray(product.images) && product.images.length ? product.images[0] : undefined,
      size: item.variantId ? undefined : (item.size || undefined),
      color: item.color || undefined,
      variants: item.variants,
      variantId: item.variantId,
      sku: item.sku
    };
    items.push(orderItem);
    reservations.push({
      product: product._id,
      quantity: qty,
      ...(item.variantId ? { variantId: item.variantId } : { size: item.size, color: item.color }),
      ...(typeof item.sku === 'string' && item.sku.trim() ? { sku: item.sku.trim() } : {})
    });
  }

  return { orderItems: items, reservationItems: reservations, totalAmount: total };
}

export async function finalizePaymentSessionToOrder(session, {
  paymentMethod = 'card',
  paymentStatus = 'completed',
  paymentDetails = {},
  orderNumber: orderNumberOverride
} = {}) {
  if (!session) {
    throw new Error('session_required');
  }

  if (session.orderId) {
    const existing = await Order.findById(session.orderId);
    if (existing) {
      return { order: existing, created: false };
    }
  }

  const couponInfo = normalizeCoupon(session);
  const { orderItems, reservationItems, totalAmount: catalogTotal } = await buildOrderItems(session);
  let totalAmount = catalogTotal;
  if (couponInfo?.discount) {
    totalAmount = Math.max(0, totalAmount - couponInfo.discount);
  }

  const shippingFeeRaw = Number(session.shippingFee);
  const shippingFee = Number.isFinite(shippingFeeRaw) && shippingFeeRaw >= 0 ? shippingFeeRaw : 0;

  try {
    if (reservationItems.length) {
      await inventoryService.reserveItems(reservationItems, null, null);
    }
  } catch (e) {
    console.warn('[paymentSession] inventory reserve failed', e?.message || e);
  }

  const orderId = new mongoose.Types.ObjectId();
  let redeemedGiftCardDoc = null;
  let redeemedGiftCardAmount = 0;
  let giftCardSnapshot = undefined;

  if (session.giftCard?.code && Number(session.giftCard?.amount) > 0) {
    const { doc, amountApplied, remainingBalance } = await redeemGiftCardForSession({
      code: session.giftCard.code,
      amount: Number(session.giftCard.amount)
    }, orderId);
    redeemedGiftCardDoc = doc;
    redeemedGiftCardAmount = amountApplied;
    giftCardSnapshot = {
      code: doc.code,
      amountApplied,
      remainingBalance
    };
  }

  const orderNumber = buildOrderNumber(session, orderNumberOverride);

  try {
    const order = await Order.create({
      _id: orderId,
      items: orderItems,
      totalAmount,
      currency: session.currency,
      exchangeRate: 1,
      shippingAddress: session.shippingAddress,
      paymentMethod,
      customerInfo: session.customerInfo,
      status: 'pending',
      orderNumber,
      shippingFee,
      deliveryFee: shippingFee,
      paymentStatus,
      coupon: couponInfo,
      giftCard: giftCardSnapshot,
      paymentDetails
    });

    session.status = paymentStatus === 'failed' ? 'failed' : 'confirmed';
    session.orderId = order._id;
    session.paymentDetails = paymentDetails;
    session.orderNumber = orderNumber;
    await session.save();

    return { order, created: true };
  } catch (err) {
    if (redeemedGiftCardDoc && redeemedGiftCardAmount > 0) {
      await rollbackGiftCardRedemption(redeemedGiftCardDoc, orderId, redeemedGiftCardAmount);
    }
    throw err;
  }
}

export async function redeemGiftCardForSession(payload, orderId) {
  const code = String(payload?.code || '').trim();
  const amount = Number(payload?.amount);
  if (!code || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('invalid_gift_card_payload');
  }
  const giftCard = await GiftCard.findOne({ code });
  if (!giftCard) throw new Error('gift_card_not_found');
  const now = new Date();
  if (giftCard.expiryDate && giftCard.expiryDate < now) {
    throw new Error('gift_card_expired');
  }
  if (giftCard.status === 'cancelled') {
    throw new Error('gift_card_cancelled');
  }
  if (giftCard.currentBalance < amount) {
    throw new Error('gift_card_insufficient');
  }
  giftCard.currentBalance -= amount;
  giftCard.lastUsed = new Date();
  giftCard.redemptions.push({ order: orderId, amount });
  await giftCard.save();
  return { doc: giftCard, amountApplied: amount, remainingBalance: giftCard.currentBalance };
}

export async function rollbackGiftCardRedemption(doc, orderId, amount) {
  try {
    doc.currentBalance += amount;
    doc.redemptions = doc.redemptions.filter((r) => String(r.order) !== String(orderId));
    await doc.save();
  } catch (e) {
    console.warn('[paymentSession] rollback gift card failed', e?.message || e);
  }
}

const SPACE_QUOTA_REGEX = /space quota/i;

function wrapStorageQuotaError(err) {
  if (SPACE_QUOTA_REGEX.test(err?.message || '')) {
    const friendly = new Error('storage_quota_exceeded');
    friendly.statusCode = 507; // HTTP 507 Insufficient Storage
    friendly.detail = 'Database storage quota exceeded. Clear space or upgrade your plan before taking new payments.';
    return friendly;
  }
  return err;
}

export async function createPaymentSessionDocument(payload) {
  try {
    return await PaymentSession.create(payload);
  } catch (err) {
    throw wrapStorageQuotaError(err);
  }
}
