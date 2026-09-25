import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Recipient from '../models/Recipient.js';
import Inventory from '../models/Inventory.js';
import { inventoryService } from '../services/inventoryService.js';
import { SUPPORTED_CURRENCIES } from '../utils/currency.js';
import { realTimeEventService } from '../services/realTimeEventService.js';
import { sendPushToAdmins, sendPushToUser } from '../services/pushService.js';
// Mobile (Expo) push support
import MobilePushToken from '../models/MobilePushToken.js';
import { sendExpoPush } from '../services/expoPushService.js';
import { whatsappFallbackForNewOrder } from '../services/whatsappFallbackService.js';
import Settings from '../models/Settings.js';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { calculateShippingFee as calcShipFee } from '../services/shippingService.js';
import DeliveryCompany from '../models/DeliveryCompany.js';
import { sendToCompany, mapStatus, validateRequiredMappings, validateCompanyConfiguration } from '../services/deliveryIntegrationService.js';

// Update (admin) - update recipient/customer info, shipping address (city/street), status, and optionally shipping fee
export const updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      customerInfo: ci,
      shippingAddress: sa,
      status,
      paymentStatus,
      shippingFee,
      deliveryFee
    } = req.body || {};

    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    // Update customer info fields if provided
    if (ci && typeof ci === 'object') {
      order.customerInfo = {
        ...order.customerInfo?.toObject?.() || order.customerInfo || {},
        ...(ci.firstName ? { firstName: ci.firstName } : {}),
        ...(ci.lastName ? { lastName: ci.lastName } : {}),
        ...(ci.email ? { email: ci.email } : {}),
        ...(ci.mobile ? { mobile: ci.mobile } : {}),
        ...(ci.secondaryMobile ? { secondaryMobile: ci.secondaryMobile } : {})
      };
    }

    // Update shipping address (only allow street & city; never allow changing country for now)
    if (sa && typeof sa === 'object') {
      const next = { ...(order.shippingAddress || {}) };
      if (sa.street) next.street = sa.street;
      if (sa.city) next.city = sa.city; // critical fix for city not persisting
      order.shippingAddress = next;
    }

    const prevStatus = order.status;

    // Status update
    if (status && typeof status === 'string' && status !== order.status) {
      order.status = status;
    }

    if (paymentStatus && typeof paymentStatus === 'string' && ['pending', 'completed', 'failed'].includes(paymentStatus)) {
      order.paymentStatus = paymentStatus;
    }

    // Optional shipping fee override (support zero values and legacy deliveryFee in same request)
    if (typeof shippingFee === 'number' && shippingFee >= 0) {
      order.shippingFee = shippingFee;
    }
    if (typeof deliveryFee === 'number' && deliveryFee >= 0) {
      order.deliveryFee = deliveryFee;
    }

    await order.save();

    // Apply inventory side effects when status changed through this endpoint too.
    if (order.status !== prevStatus) {
      let invCfg = null;
      try { invCfg = (await Settings.findOne().sort({ updatedAt: -1 }))?.inventory || null; } catch {}
      const hasCfg = invCfg && (Object.prototype.hasOwnProperty.call(invCfg, 'reserveOnCheckout') || Object.prototype.hasOwnProperty.call(invCfg, 'autoDecrementOnOrder'));
      const decrementedAtOrder = hasCfg ? !!(invCfg?.reserveOnCheckout || invCfg?.autoDecrementOnOrder) : true;
      const shouldDecrementOnDelivery = !decrementedAtOrder;
      const hasCancelCfg = invCfg && Object.prototype.hasOwnProperty.call(invCfg, 'autoIncrementOnCancel');
      const shouldIncrementOnCancel = hasCancelCfg ? !!invCfg?.autoIncrementOnCancel : true;
      const hasReturnCfg = invCfg && Object.prototype.hasOwnProperty.call(invCfg, 'autoIncrementOnReturn');
      const shouldIncrementOnReturn = hasReturnCfg ? !!invCfg?.autoIncrementOnReturn : true;

      const asInventoryItems = (items) => items.map(it => ({
        product: it.product,
        quantity: it.quantity,
        ...(it.variantId ? { variantId: it.variantId } : { size: it.size, color: it.color }),
        ...(typeof it.sku === 'string' && it.sku.trim() ? { sku: it.sku.trim() } : {})
      }));

      if ((order.status === 'delivered' || order.status === 'fulfilled') && shouldDecrementOnDelivery) {
        try { await inventoryService.reserveItems(asInventoryItems(order.items), req.user?._id || null); } catch (e) { console.warn('Delivery decrement failed (updateOrder):', e?.message || e); }
      }

      // Re-open flow: if an order was cancelled and moved back to pending,
      // reserve inventory again to reverse the previous cancel increment.
      if (prevStatus === 'cancelled' && order.status === 'pending' && shouldIncrementOnCancel && decrementedAtOrder) {
        try { await inventoryService.reserveItems(asInventoryItems(order.items), req.user?._id || null); } catch (e) { console.warn('Re-open decrement failed (updateOrder):', e?.message || e); }
      }

      const decrementedBeforeCancel = decrementedAtOrder || prevStatus === 'delivered' || prevStatus === 'fulfilled';
      if (order.status === 'cancelled' && shouldIncrementOnCancel && decrementedBeforeCancel) {
        try { await inventoryService.incrementItems(asInventoryItems(order.items), req.user?._id || null, 'Order cancelled'); } catch (e) { console.warn('Cancel increment failed (updateOrder):', e?.message || e); }
      }

      // Hard fallback: when order is cancelled, force absolute MCG sync for affected products
      // even if increment was skipped due settings/state.
      if (order.status === 'cancelled') {
        const touchedProducts = Array.from(new Set((order.items || []).map(it => String(it.product || '')).filter(Boolean)));
        for (const pid of touchedProducts) {
          try { await inventoryService.pushMcgForEntireProduct(pid); } catch (e) { console.warn('Cancel MCG force-push failed (updateOrder):', e?.message || e); }
        }
      }

      if (order.status === 'returned' && shouldIncrementOnReturn) {
        try { await inventoryService.incrementItems(asInventoryItems(order.items), req.user?._id || null, 'Order returned'); } catch (e) { console.warn('Return increment failed (updateOrder):', e?.message || e); }
      }
    }

    // Emit real-time event so admin dashboards refresh
    try { realTimeEventService.emitOrderUpdate(order); } catch {}

    res.json({ message: 'Order updated', order });
  } catch (error) {
    console.error('Error updating order (admin):', error);
    res.status(500).json({ message: 'Failed to update order', error: error?.message });
  }
};

// Create order
export const createOrder = async (req, res) => {
  const session = await mongoose.startSession();
  let useTransaction = false;

  try {
    console.log('createOrder called with body:', JSON.stringify(req.body, null, 2));
    // Guard against SKIP_DB mode: meaningful error instead of opaque 500s when DB is intentionally disabled.
    if (process.env.SKIP_DB === '1') {
      return res.status(503).json({
        message: 'Order creation unavailable with SKIP_DB=1. Disable SKIP_DB to persist orders and process payments.',
        skipDb: true
      });
    }
  const { items, shippingAddress, paymentMethod, customerInfo } = req.body;

    const blockCardDrafts = String(process.env.ALLOW_CARD_ORDER_DRAFTS || 'false').toLowerCase() !== 'true';
    if (blockCardDrafts && paymentMethod === 'card') {
      return res.status(409).json({
        message: 'Card payments must be created after the provider confirms payment. Start a payment session instead of calling /orders directly.',
        code: 'CARD_PAYMENT_REQUIRES_SESSION'
      });
    }

    const couponInfo = (req.body?.coupon && req.body.coupon.code)
      ? { code: String(req.body.coupon.code).trim(), discount: Math.max(0, Number(req.body.coupon.discount) || 0) }
      : undefined;

    // If the request includes a Bearer token, attempt to associate the order with the authenticated user
    try {
      const authHeader = req.header('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : null;
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (user) {
          // Attach to request for downstream usage
          req.user = user;
        }
      }
    } catch (e) {
      // Silently ignore token errors to allow guest checkout
      console.warn('Optional auth token invalid for createOrder; proceeding as guest if needed.');
    }

    // Single store currency mode: trust incoming currency if matches store setting; else force store currency
    let currency = req.body?.currency;
    try {
      const storeSettings = await Settings.findOne().sort({ updatedAt: -1 });
      const storeCurrency = storeSettings?.currency || process.env.STORE_CURRENCY || 'USD';
      if (!currency || currency !== storeCurrency) {
        currency = storeCurrency;
      }
    } catch {
      currency = process.env.STORE_CURRENCY || currency || 'USD';
    }

    // Validate required fields
    if (!items?.length) {
      return res.status(400).json({ message: 'Order must contain at least one item' });
    }

    if (!customerInfo?.email || !customerInfo?.mobile) {
      return res.status(400).json({ message: 'Customer email and mobile number are required' });
    }

    if (!shippingAddress?.street || !shippingAddress?.city || !shippingAddress?.country) {
      return res.status(400).json({ message: 'Complete shipping address is required' });
    }

    const normalizedAreaGroup = typeof shippingAddress.areaGroup === 'string' ? shippingAddress.areaGroup.trim() : '';
    const normalizedShippingAddress = {
      street: shippingAddress.street,
      city: shippingAddress.city,
      country: shippingAddress.country,
      areaGroup: normalizedAreaGroup
    };

    // In single-currency mode we only validate equality with store currency; SUPPORTED_CURRENCIES retained for backward compatibility.
    if (!SUPPORTED_CURRENCIES[currency]) {
      return res.status(400).json({ message: 'Store currency not recognized in configuration' });
    }

    // Attempt to start transaction; if not supported (e.g., standalone Mongo), continue without it
    try {
      await session.startTransaction();
      useTransaction = true;
    } catch (txnErr) {
      console.warn('MongoDB transactions not supported in current environment; proceeding without transaction. Reason:', txnErr?.message || txnErr);
    }

  // Calculate total and validate stock
    // We now treat catalog product.price as already expressed in the chosen store currency.
    // Previous implementation multiplied by an exchangeRate (assuming a USD base) which caused inflated totals
    // when catalog prices were already in the display currency. We set exchangeRate=1 for backward compatibility.
    let totalAmount = 0;
    const orderItems = [];
    const exchangeRate = 1; // No runtime FX conversion; prices stored as-is
    const stockUpdates = []; // Track stock updates for rollback

    // Defensive normalization of product/variant ids to avoid CastError from accidental suffixes
    const isObjectId = (v) => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);
    const sanitizeItem = (it) => {
      let productId = String(it.product || '');
      let variantId = it.variantId ? String(it.variantId) : undefined;
      const originalProductId = productId;
      if (!isObjectId(productId)) {
        // Try composite with colon (product:variant)
        if (productId.includes(':')) {
          const [pid, vid] = productId.split(':');
          if (isObjectId(pid)) {
            productId = pid;
            if (!variantId && isObjectId(String(vid))) variantId = String(vid);
          }
        }
      }
      if (!isObjectId(productId) && productId.includes('_')) {
        // Strip accidental UI suffix like _3
        const [pid] = productId.split('_');
        if (isObjectId(pid)) productId = pid;
      }
      if (originalProductId !== productId) {
        try { console.warn('[createOrder] Normalized product id from %s to %s', originalProductId, productId); } catch {}
      }
      return { ...it, product: productId, variantId };
    };
    const normalizedItems = Array.isArray(items) ? items.map(sanitizeItem) : [];

  const reservationItems = [];
  for (const item of normalizedItems) {
      if (!isObjectId(String(item.product))) {
        if (session.inTransaction()) await session.abortTransaction();
        return res.status(400).json({ message: `Invalid product id: ${String(item.product)}` });
      }
      const baseProductQuery = Product.findById(item.product);
      const product = useTransaction ? await baseProductQuery.session(session) : await baseProductQuery;

      if (!product) {
        if (session.inTransaction()) await session.abortTransaction();
        return res.status(404).json({ message: `Product not found: ${item.product}` });
      }

      const qty = Number(item.quantity) || 0;
      if (qty <= 0) {
        if (session.inTransaction()) await session.abortTransaction();
        return res.status(400).json({ message: `Invalid quantity for product ${product.name}` });
      }

      const sizeName = item.size;
      const usingVariant = !!item.variantId;
      const fallbackColor = (typeof item.color === 'string' ? item.color : (item.color?.name || item.color?.code)) || undefined;
      // Prepare reservation to be executed after validating all items
      // Include size/color as fallback even for variant-based items to match legacy inventory rows if present
      reservationItems.push({
        product: product._id,
        quantity: qty,
        ...(usingVariant ? { variantId: item.variantId } : {}),
        ...(sizeName ? { size: sizeName } : {}),
        ...(fallbackColor ? { color: fallbackColor } : {}),
        ...(typeof item.sku === 'string' && item.sku.trim() ? { sku: item.sku.trim() } : {})
      });

      // Use catalog price directly (already in store currency)
      const catalogPrice = Number(product.price);
      if (!isFinite(catalogPrice)) {
        if (session.inTransaction()) await session.abortTransaction();
        return res.status(400).json({ message: `Product ${product.name} has invalid price` });
      }
      totalAmount += catalogPrice * qty;

      orderItems.push({
        product: product._id,
        quantity: qty,
        price: catalogPrice, // store unmodified
        name: product.name,
        image: Array.isArray(product.images) && product.images.length ? product.images[0] : undefined,
        // Include legacy size only when not using explicit variantId
        size: usingVariant ? undefined : (sizeName || undefined),
        // Persist optional color and generic variants if provided by client
        color: (typeof item.color === 'string' ? item.color : (item.color?.name || item.color?.code || undefined)),
        variants: Array.isArray(item.variants) ? item.variants.map(v => ({
          attributeId: v.attributeId || v.attribute || undefined,
          attributeName: v.attributeName || v.name || undefined,
          valueId: v.valueId || v.value || undefined,
          valueName: v.valueName || v.valueLabel || v.label || undefined
        })) : undefined,
        variantId: (item.variantId ? String(item.variantId) : undefined),
        sku: (typeof item.sku === 'string' ? item.sku : undefined)
      });

      // Track stock update note (no direct product mutation here; inventory service will update totals)
      stockUpdates.push({ productId: product._id });
    }

    // Inventory settings control: reserve/decrement on order placement if enabled
    let invCfg = null;
    try { invCfg = (await Settings.findOne().sort({ updatedAt: -1 }))?.inventory || null; } catch {}
  // Default to decrementing now when settings absent (safer default for most stores)
  const hasExplicitCfg = invCfg && (Object.prototype.hasOwnProperty.call(invCfg, 'reserveOnCheckout') || Object.prototype.hasOwnProperty.call(invCfg, 'autoDecrementOnOrder'));
  const shouldDecrementNow = hasExplicitCfg ? !!(invCfg?.reserveOnCheckout || invCfg?.autoDecrementOnOrder) : true;
    if (shouldDecrementNow) {
      // Reserve (decrement) inventory across warehouses for all items atomically
      await inventoryService.reserveItems(reservationItems, req.user?._id, useTransaction ? session : null);
    }

    // Save or update recipient in Recipient collection
    const recipientQuery = {
      email: customerInfo.email,
      mobile: customerInfo.mobile
    };
    const recipientUpdate = {
      firstName: customerInfo.firstName,
      lastName: customerInfo.lastName,
      email: customerInfo.email,
      mobile: customerInfo.mobile,
      secondaryMobile: customerInfo.secondaryMobile,
      address: {
        street: normalizedShippingAddress.street,
        city: normalizedShippingAddress.city,
        country: normalizedShippingAddress.country,
        areaGroup: normalizedShippingAddress.areaGroup
      }
    };
    if (useTransaction) {
      await Recipient.findOneAndUpdate(recipientQuery, recipientUpdate, { upsert: true, new: true, session });
    } else {
      await Recipient.findOneAndUpdate(recipientQuery, recipientUpdate, { upsert: true, new: true });
    }

    // --- Shipping Fee Resolution ---
    // Priority:
    // 1. If client explicitly sent a positive shippingFee (flat fee UI) trust it (configurable via ALLOW_CLIENT_SHIPPING_FEE=true)
    // 2. Else attempt dynamic calculation via shipping service
    // 3. If calc fails OR returns 0 while client provided a positive hint in totalWithShipping, derive difference
    // 4. Final fallback: DEFAULT_SHIPPING_FEE env or 50
    let shippingFee = 0;
    let shippingMeta = {
      city: normalizedShippingAddress?.city,
      rateId: null,
      zoneId: null,
      methodName: null,
      costComponents: []
    };
    const allowClientProvided = String(process.env.ALLOW_CLIENT_SHIPPING_FEE || 'true').toLowerCase() !== 'false';
  const rawShippingFee = req.body?.shippingFee;
  const rawClientShippingFee = req.body?.clientShippingFee;
  const rawDeliveryFee = req.body?.deliveryFee;
  const clientShippingFee = Number(rawShippingFee);
  const clientAltFee = Number(rawClientShippingFee);
  const clientDeliveryFee = Number(rawDeliveryFee);
  const clientTotalWithShipping = Number(req.body?.totalWithShipping);
    const clientProvidedValid = allowClientProvided && isFinite(clientShippingFee) && clientShippingFee > 0;

    if (clientProvidedValid) {
      shippingFee = clientShippingFee;
    } else if (allowClientProvided && isFinite(clientAltFee) && clientAltFee > 0) {
      // Fallback: some clients send clientShippingFee only
      shippingFee = clientAltFee;
    } else if (allowClientProvided && isFinite(clientDeliveryFee) && clientDeliveryFee > 0) {
      // Legacy / alternate field
      shippingFee = clientDeliveryFee;
    } else {
      try {
        const addressCountry = normalizedShippingAddress.country;
        const addressCity = normalizedShippingAddress.city;
        shippingFee = await calcShipFee({ subtotal: totalAmount, weight: 0, country: addressCountry, region: normalizedShippingAddress.areaGroup || undefined, city: addressCity });
        if (!isFinite(shippingFee) || shippingFee < 0) shippingFee = 0;
      } catch (e) {
        console.warn('Shipping fee calculation failed, will use fallback logic:', e?.message || e);
        shippingFee = 0; // trigger fallback below
      }
    }

    console.log('[ShippingResolution]', {
      rawShippingFee,
      rawClientShippingFee,
      rawDeliveryFee,
      clientShippingFeeParsed: clientShippingFee,
      clientAltFeeParsed: clientAltFee,
      clientDeliveryFeeParsed: clientDeliveryFee,
      clientTotalWithShipping,
      chosenShippingFee: shippingFee,
      allowClientProvided
    });

    // Hard override safeguard: if all logic above yielded 0 but request clearly sent a positive numeric value, adopt it now.
    if (shippingFee === 0) {
      const rawCandidates = [rawShippingFee, rawClientShippingFee, rawDeliveryFee]
        .map(v => (typeof v === 'string' ? v.trim() : v))
        .map(v => Number(v))
        .filter(v => isFinite(v) && v > 0);
      if (rawCandidates.length) {
        const forced = Math.max(...rawCandidates);
        shippingFee = forced;
        console.log('[ShippingResolution][HardOverrideApplied]', { forced, rawCandidates });
      }
    }

    if (shippingFee === 0) {
      // Attempt to infer from client totalWithShipping if provided
      if (clientTotalWithShipping && clientTotalWithShipping > totalAmount) {
        const inferred = clientTotalWithShipping - totalAmount;
        if (isFinite(inferred) && inferred > 0) shippingFee = inferred;
      }
    }

    if (shippingFee === 0) {
      // Final fallback
      const fallback = Number(process.env.DEFAULT_SHIPPING_FEE || 50);
      if (isFinite(fallback) && fallback > 0) shippingFee = fallback;
    }

    // Last-chance rescue: if still 0 but any raw positive values were provided, take the maximum raw positive
    if (shippingFee === 0) {
      const candidates = [clientShippingFee, clientAltFee, clientDeliveryFee].filter(v => isFinite(v) && v > 0);
      if (candidates.length) {
        shippingFee = Math.max(...candidates);
        console.log('[ShippingResolution][RescueApplied]', { rescueChosen: shippingFee, candidates });
      }
    }

  // Final assertion: log before create
  console.log('[ShippingResolution][Final]', { shippingFee, deliveryFeeMirror: shippingFee });
  if (shippingFee === 0) {
    const rawPositives = [rawShippingFee, rawClientShippingFee, rawDeliveryFee].map(v => Number(v)).filter(v => isFinite(v) && v > 0);
    if (rawPositives.length) {
      console.warn('[ShippingResolution][Anomaly] Raw positive fee(s) provided but computed/final shippingFee resolved to 0. Raw values:', {
        rawShippingFee,
        rawClientShippingFee,
        rawDeliveryFee,
        parsed: rawPositives
      });
    }
  }
  // Absolute final guard: if request body had a positive shippingFee value, force it.
  if (shippingFee === 0 && isFinite(Number(rawShippingFee)) && Number(rawShippingFee) > 0) {
    console.warn('[ShippingResolution][ForceFromRawBody] Forcing shippingFee from raw body value', { rawShippingFee });
    shippingFee = Number(rawShippingFee);
  }
  // Create order with auto-generated order number (include shipping & delivery fee fields)
    const order = new Order({
      user: req.user?._id || undefined,
      items: orderItems,
      totalAmount,
      currency,
      exchangeRate,
      shippingAddress: normalizedShippingAddress,
      paymentMethod,
      customerInfo: {
        firstName: customerInfo.firstName,
        lastName: customerInfo.lastName,
        email: customerInfo.email,
        mobile: customerInfo.mobile,
        secondaryMobile: customerInfo.secondaryMobile
      },
      status: 'pending',
      orderNumber: `ORD${Date.now()}`,
      // Persist only one authoritative shipping fee and mirror it to deliveryFee for legacy consumers.
      shippingFee,
      deliveryFee: shippingFee,
      shippingCity: shippingMeta.city,
      shippingZoneId: shippingMeta.zoneId,
      shippingRateId: shippingMeta.rateId,
      shippingMethodName: shippingMeta.methodName,
      shippingCostComponents: shippingMeta.costComponents,
      shippingCalculation: {
        subtotal: totalAmount,
        country: normalizedShippingAddress.country,
        city: normalizedShippingAddress.city,
        areaGroup: normalizedShippingAddress.areaGroup,
        weight: 0
      },
      coupon: couponInfo,
      // For online payments (card/paypal), mark as pending until provider capture completes
      paymentStatus: paymentMethod === 'cod' ? 'pending' : 'pending'
    });

    let savedOrder;
    try {
      if (useTransaction) {
        savedOrder = await order.save({ session });
      } else {
        savedOrder = await order.save();
      }
    } catch (err) {
      // Handle duplicate orderNumber edge case: regenerate and retry once
      if (err && err.code === 11000 && err.keyPattern && err.keyPattern.orderNumber) {
        order.orderNumber = `ORD${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        if (useTransaction) {
          savedOrder = await order.save({ session });
        } else {
          savedOrder = await order.save();
        }
      } else {
        if (session.inTransaction()) {
          await session.abortTransaction();
        }
        throw err;
      }
    }

    // Commit the transaction
    if (session.inTransaction()) {
      await session.commitTransaction();
    }

    // Emit real-time event for new order
    try { realTimeEventService.emitNewOrder(savedOrder); } catch (e) { console.warn('Failed to emit new order event:', e?.message || e); }

    // Fire web push notification targeted to admins only
    let webPushSent = 0;
    try {
      const contactEnabled = String(process.env.WHATSAPP_CONTACT_IN_PUSH || 'false').toLowerCase() === 'true';
      const primaryContact = process.env.WHATSAPP_PRIMARY_CONTACT_NUMBER || '';
      const contactLine = (contactEnabled && primaryContact) ? ` • WhatsApp: ${primaryContact}` : '';
      const icon = '/favicon.svg';
      const orderAdminUrl = `/admin/orders/${savedOrder._id}`; // deep-link target
      const payload = {
        title: 'New Order Received',
        body: `Order ${savedOrder.orderNumber} • ${savedOrder.items.length} item(s) • ${savedOrder.totalAmount} ${savedOrder.currency}${contactLine}`,
        url: orderAdminUrl,
        tag: 'new-order',
        requireInteraction: true,
        icon,
        badge: icon,
        silent: false,
        vibrate: [200,100,200]
      };
      console.log('[Push][NewOrder][Web] Prepared payload', payload);
      const adminResult = await sendPushToAdmins(payload);
      console.log('[Push][NewOrder][Web] Admin result', adminResult);
      webPushSent = adminResult.sent || 0;
      if (webPushSent === 0) {
        console.log('[Push][NewOrder][Web] No admin web push subscriptions available; skipping global fallback broadcast.');
      }
    } catch (pushErr) {
      console.warn('[Push][NewOrder][Web] Failed to send web push', pushErr);
    }

    // Fire Expo (mobile) push notifications to admin devices only
    let expoPushSent = 0;
    try {
      const expoEnable = String(process.env.EXPO_PUSH_ON_NEW_ORDER || 'true').toLowerCase() !== 'false';
      if (expoEnable) {
        // Aggregate admin tokens (similar to mobilePushController.broadcastToAdmins)
        const adminTokensAgg = await MobilePushToken.aggregate([
          { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'u' } },
          { $unwind: '$u' },
          { $match: { 'u.role': 'admin' } },
          { $project: { expoPushToken: 1 } }
        ]);
        const adminTokens = adminTokensAgg.map(d => d.expoPushToken);
        const title = 'طلب جديد'; // Arabic for "New Order"
        const body = `${savedOrder.orderNumber} • ${savedOrder.items.length} عناصر • ${savedOrder.totalAmount} ${savedOrder.currency}`;
        const data = { type: 'new-order', orderId: savedOrder._id.toString(), orderNumber: savedOrder.orderNumber, items: savedOrder.items.length };
        if (adminTokens.length) {
          const result = await sendExpoPush({ tokens: adminTokens, title, body, data });
          console.log('[Push][NewOrder][Expo] Admin receipts', result);
          expoPushSent = adminTokens.length; // assume delivery attempt count
        }
        if (expoPushSent === 0) {
          console.log('[Push][NewOrder][Expo] No admin mobile tokens available; skipping global fallback broadcast.');
        }
      }
    } catch (expoErr) {
      console.warn('[Push][NewOrder][Expo] Failed to send expo push', expoErr);
    }

    // Send order notification only to the order owner (when identifiable as a user account)
    try {
      const normalizedEmail = String(savedOrder?.customerInfo?.email || '').trim().toLowerCase();
      let ownerUser = null;

      if (savedOrder?.user) {
        ownerUser = await User.findById(savedOrder.user).select('_id role notificationPreferences').lean();
      }

      if (!ownerUser && normalizedEmail) {
        ownerUser = await User.findOne({ email: normalizedEmail }).select('_id role notificationPreferences').lean();
      }

      const ownerCanReceiveOrderUpdates = !!ownerUser
        && ownerUser.role !== 'admin'
        && ownerUser.notificationPreferences?.orderUpdates !== false;

      if (ownerCanReceiveOrderUpdates) {
        const ownerPayload = {
          title: 'Order Confirmed',
          body: `Your order ${savedOrder.orderNumber} has been received.`,
          url: `/my-orders/${savedOrder._id}`,
          tag: `order-${savedOrder._id}`,
          requireInteraction: false,
          icon: '/favicon.svg',
          badge: '/favicon.svg',
          silent: false,
          vibrate: [100, 50, 100]
        };

        const ownerWebResult = await sendPushToUser(ownerUser._id, ownerPayload);
        console.log('[Push][OrderOwner][Web] Result', { userId: String(ownerUser._id), ...ownerWebResult });

        const ownerTokenDocs = await MobilePushToken.find({ user: ownerUser._id }).lean().select('expoPushToken');
        const ownerTokens = ownerTokenDocs.map(d => d.expoPushToken).filter(Boolean);
        if (ownerTokens.length) {
          const ownerExpoResult = await sendExpoPush({
            tokens: ownerTokens,
            title: 'Order Confirmed',
            body: `Your order ${savedOrder.orderNumber} has been received.`,
            data: {
              type: 'order-owner-update',
              orderId: savedOrder._id.toString(),
              orderNumber: savedOrder.orderNumber,
              status: savedOrder.status
            }
          });
          console.log('[Push][OrderOwner][Expo] Result', { userId: String(ownerUser._id), attempts: ownerTokens.length, ownerExpoResult });
        }
      } else {
        console.log('[Push][OrderOwner] Skipped (no eligible owner user found or orderUpdates disabled).');
      }
    } catch (ownerPushErr) {
      console.warn('[Push][OrderOwner] Failed to send owner notification', ownerPushErr);
    }

    // If no push delivered across both channels, generate WhatsApp manual notification links (internal logging only)
    if ((webPushSent === 0) && (expoPushSent === 0)) {
      try {
        await whatsappFallbackForNewOrder(savedOrder);
      } catch (waErr) {
        console.warn('WhatsApp fallback generation failed (non-fatal)', waErr);
      }
    }

    // Attempt auto-dispatch to delivery company if configuration enables it.
    let autoDispatchResult = null;
    try {
      // Guard against long waits to keep API responsive
      const AUTO_DISPATCH_TIMEOUT_MS = Number(process.env.AUTO_DISPATCH_TIMEOUT_MS || 8000);
      const withTimeout = (p) => new Promise((resolve) => {
        let settled = false;
        const t = setTimeout(() => { if (!settled) { settled = true; resolve({ timeout: true }); } }, AUTO_DISPATCH_TIMEOUT_MS);
        p.then((v) => { if (!settled) { settled = true; clearTimeout(t); resolve(v); } })
         .catch((e) => { if (!settled) { settled = true; clearTimeout(t); resolve({ error: e }); } });
      });
      // Find an active delivery company with autoDispatchOnOrderCreate enabled.
      const autoCompany = await DeliveryCompany.findOne({ isActive: true, autoDispatchOnOrderCreate: true }).sort('-isDefault');
      if (autoCompany) {
        const statuses = Array.isArray(autoCompany.autoDispatchStatuses) && autoCompany.autoDispatchStatuses.length
          ? autoCompany.autoDispatchStatuses
          : ['pending'];
        if (statuses.includes(savedOrder.status)) {
          // Validate configuration before sending
          const cfg = validateCompanyConfiguration(autoCompany.toObject());
          if (cfg.ok) {
            const mappingCheck = validateRequiredMappings(savedOrder.toObject(), autoCompany.toObject());
            if (mappingCheck.ok) {
              const deliveryFee = savedOrder.shippingFee || savedOrder.deliveryFee || 0;
              const dispatchAttempt = withTimeout(sendToCompany(savedOrder.toObject(), autoCompany.toObject(), { deliveryFee }));
              const dispatchResult = await dispatchAttempt;
              if (dispatchResult?.timeout) {
                autoDispatchResult = { success: false, reason: 'TIMEOUT' };
              } else if (dispatchResult?.error) {
                throw dispatchResult.error;
              } else {
                const { trackingNumber, providerResponse, providerStatus } = dispatchResult;
              savedOrder.deliveryCompany = autoCompany._id;
              savedOrder.deliveryStatus = mapStatus(autoCompany, providerStatus || 'assigned');
              savedOrder.deliveryTrackingNumber = trackingNumber;
              savedOrder.trackingNumber = trackingNumber; // legacy
              savedOrder.deliveryAssignedAt = new Date();
              savedOrder.deliveryFee = deliveryFee || savedOrder.deliveryFee || 0;
              savedOrder.deliveryResponse = providerResponse;
              await savedOrder.save();
              autoDispatchResult = {
                success: true,
                companyId: String(autoCompany._id),
                trackingNumber,
                status: savedOrder.deliveryStatus,
                providerStatus: providerStatus || 'assigned'
              };
              }
            } else {
              autoDispatchResult = { success: false, reason: 'MISSING_MAPPINGS', missing: mappingCheck.missing };
            }
          } else {
            autoDispatchResult = { success: false, reason: 'INVALID_CONFIGURATION', issues: cfg.issues };
          }
        } else {
          autoDispatchResult = { success: false, reason: 'STATUS_NOT_ELIGIBLE', orderStatus: savedOrder.status };
        }
      } else {
        autoDispatchResult = { success: false, reason: 'NO_AUTO_COMPANY' };
      }
    } catch (autoErr) {
      console.warn('Auto-dispatch failed (non-fatal):', autoErr);
      autoDispatchResult = { success: false, reason: 'AUTO_DISPATCH_ERROR', error: autoErr?.message };
    }

    res.status(201).json({
      message: 'Order created successfully',
      order: {
        _id: savedOrder._id,
        orderNumber: savedOrder.orderNumber,
        totalAmount: savedOrder.totalAmount,
        currency: savedOrder.currency,
        status: savedOrder.status,
        deliveryFee: savedOrder.deliveryFee || 0,
        shippingFee: savedOrder.shippingFee || savedOrder.deliveryFee || 0,
        deliveryStatus: savedOrder.deliveryStatus || null,
        deliveryTrackingNumber: savedOrder.deliveryTrackingNumber || savedOrder.trackingNumber || null,
        autoDispatch: autoDispatchResult,
        // Provide core fields so clients can render order details without another fetch
        items: Array.isArray(savedOrder.items) ? savedOrder.items.map(it => ({
          product: it.product,
          name: it.name,
          image: it.image,
          quantity: it.quantity,
          price: it.price,
          size: it.size,
          color: it.color,
          variants: it.variants,
          variantId: it.variantId,
          sku: it.sku
        })) : [],
        shippingAddress: savedOrder.shippingAddress,
        paymentMethod: savedOrder.paymentMethod,
        createdAt: savedOrder.createdAt,
        totalWithShipping: (() => {
          const base = savedOrder.totalAmount || 0;
          const ship = savedOrder.shippingFee || savedOrder.deliveryFee || 0;
          // Reuse same heuristic as model virtual (without recomputing items to avoid duplication)
          // If items subtotal can be derived and base already includes ship, return base.
          let reconstructedSubtotal = 0;
          try {
            if (Array.isArray(savedOrder.items)) {
              for (const it of savedOrder.items) {
                if (it && typeof it.price === 'number' && typeof it.quantity === 'number') {
                  reconstructedSubtotal += (it.price * it.quantity);
                }
              }
            }
          } catch {}
          if (reconstructedSubtotal > 0) {
            const diff = Math.abs((base - reconstructedSubtotal) - ship);
            if (diff < 0.0001) return base;
          }
          return base + ship;
        })()
      }
    });
  } catch (error) {
    // Ensure transaction is aborted if still active
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error('Error creating order:', error);
    const message = error?.message || 'Failed to create order';
    const statusCode = Number(error?.statusCode) || 500;
    res.status(statusCode).json({
      message,
      error: message
    });
  } finally {
    // End the session
    await session.endSession();
  }
};

// Get user orders
export const getUserOrders = async (req, res) => {
  try {
    const userId = req.user?._id;
    const userEmail = (req.user?.email || '').toLowerCase();

    // Filter orders to those created by this user or (legacy) guest orders matching their email
    const emailFilter = userEmail
      ? { 'customerInfo.email': new RegExp(`^${userEmail}$`, 'i') }
      : null;

    const query = emailFilter
      ? { $or: [ { user: userId }, emailFilter ] }
      : { user: userId };

    const ordersDocs = await Order.find(query)
      .populate('items.product')
      .populate('deliveryCompany')
      .sort('-createdAt');
    // Ensure virtuals present and add explicit totalWithShipping in case consumer relies on it
    const orders = ordersDocs.map(o => {
      const obj = o.toObject({ virtuals: true });
      return {
        ...obj,
        // effectiveShippingFee virtual already resolves shipping vs delivery
        effectiveShippingFee: obj.effectiveShippingFee ?? (obj.shippingFee || obj.deliveryFee || 0),
        totalWithShipping: obj.totalWithShipping ?? ((obj.totalAmount || 0) + (obj.shippingFee || obj.deliveryFee || 0))
      };
    });
    res.json(orders);
  } catch (error) {
    console.error('Error fetching user orders:', error);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
};

// Get all orders (admin)
export const getAllOrders = async (req, res) => {
  try {
    const ordersDocs = await Order.find()
      .populate('items.product')
      .populate('deliveryCompany')
      .sort('-createdAt');

    const productIds = Array.from(new Set(
      ordersDocs.flatMap(order => (order.items || [])
        .map(item => String(item.product?._id || item.product || ''))
        .filter(Boolean))
    ));
    const inventoryRows = productIds.length
      ? await Inventory.find({ product: { $in: productIds } }).select('product variantId size color quantity').lean()
      : [];
    const inventoryQuantityByKey = new Map();
    const inventoryQuantityByProduct = new Map();
    const hasNegativeStockByProduct = new Map();
    const inventoryKey = ({ product, variantId, size, color }) => {
      const productId = String(product?._id || product || '');
      if (variantId) return `${productId}|variant:${String(variantId)}`;
      const normalizedSize = (size && String(size).trim()) ? String(size).trim() : 'Default';
      const normalizedColor = (color && String(color).trim()) ? String(color).trim() : 'Default';
      return `${productId}|legacy:${normalizedSize}|${normalizedColor}`;
    };
    for (const row of inventoryRows) {
      const productId = String(row.product?._id || row.product || '');
      const quantity = Number(row.quantity) || 0;
      const key = inventoryKey(row);
      inventoryQuantityByKey.set(key, (inventoryQuantityByKey.get(key) || 0) + quantity);
      inventoryQuantityByProduct.set(productId, (inventoryQuantityByProduct.get(productId) || 0) + quantity);
      if (quantity < 0) hasNegativeStockByProduct.set(productId, true);
    }

    const orders = ordersDocs.map(o => {
      const obj = o.toObject({ virtuals: true });
      const items = Array.isArray(obj.items) ? obj.items.map(item => {
        const productId = String(item.product?._id || item.product || '');
        const exactStockQuantity = inventoryQuantityByKey.get(inventoryKey(item));
        const stockQuantity = exactStockQuantity ?? inventoryQuantityByProduct.get(productId) ?? 0;
        const hasNegativeStock = stockQuantity < 0 || hasNegativeStockByProduct.get(productId) === true;
        return {
          ...item,
          stockQuantity,
          hasNegativeStock
        };
      }) : [];
      return {
        ...obj,
        items,
        hasNegativeStock: items.some(item => item.hasNegativeStock),
        effectiveShippingFee: obj.effectiveShippingFee ?? (obj.shippingFee || obj.deliveryFee || 0),
        totalWithShipping: obj.totalWithShipping ?? ((obj.totalAmount || 0) + (obj.shippingFee || obj.deliveryFee || 0))
      };
    });
    res.json(orders);
  } catch (error) {
    console.error('Error fetching all orders:', error);
    res.status(500).json({ message: 'Failed to fetch orders' });
  }
};

// Get a single order by ID (public: used for guest checkout "View Order")
// Returns basic order details with populated product refs. You may tighten access later (e.g., token + ownership check).
export const getOrderPublic = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('items.product');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    const obj = order.toObject({ virtuals: true });
    const response = {
      ...obj,
      effectiveShippingFee: obj.effectiveShippingFee ?? (obj.shippingFee || obj.deliveryFee || 0),
      totalWithShipping: obj.totalWithShipping ?? ((obj.totalAmount || 0) + (obj.shippingFee || obj.deliveryFee || 0))
    };
    res.json({ order: response });
  } catch (error) {
    console.error('Error fetching order by id:', error);
    res.status(500).json({ message: 'Failed to load order', error: error?.message });
  }
};

// Update order status
export const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order id' });
    }

    const allowedStatuses = Order.schema.path('status')?.enumValues || [];
    if (typeof status !== 'string' || !allowedStatuses.includes(status)) {
      return res.status(400).json({
        message: 'Invalid order status',
        allowedStatuses
      });
    }

    // Find the order first to check previous status
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    const prevStatus = order.status;

    if (prevStatus === status) {
      return res.json({
        message: 'Order status updated successfully',
        order
      });
    }

    // Persist only the status field so legacy orders with unrelated invalid fields do not fail.
    await Order.updateOne(
      { _id: order._id },
      { $set: { status } },
      { runValidators: true }
    );
    order.status = status;

    // Inventory configuration driven stock adjustments
    let invCfg = null;
    try { invCfg = (await Settings.findOne().sort({ updatedAt: -1 }))?.inventory || null; } catch {}
    const hasCfg = invCfg && (Object.prototype.hasOwnProperty.call(invCfg, 'reserveOnCheckout') || Object.prototype.hasOwnProperty.call(invCfg, 'autoDecrementOnOrder'));
    const decrementedAtOrder = hasCfg ? !!(invCfg?.reserveOnCheckout || invCfg?.autoDecrementOnOrder) : true;
    const shouldDecrementOnDelivery = !decrementedAtOrder;
    const hasCancelCfg = invCfg && Object.prototype.hasOwnProperty.call(invCfg, 'autoIncrementOnCancel');
    const shouldIncrementOnCancel = hasCancelCfg ? !!invCfg?.autoIncrementOnCancel : true;
    const hasReturnCfg = invCfg && Object.prototype.hasOwnProperty.call(invCfg, 'autoIncrementOnReturn');
    const shouldIncrementOnReturn = hasReturnCfg ? !!invCfg?.autoIncrementOnReturn : true;

    // Build items array in variant-aware form
    const asInventoryItems = (items) => items.map(it => ({
      product: it.product,
      quantity: it.quantity,
      ...(it.variantId ? { variantId: it.variantId } : { size: it.size, color: it.color }),
      ...(typeof it.sku === 'string' && it.sku.trim() ? { sku: it.sku.trim() } : {})
    }));

    // Auto-decrement when delivered if not already decremented earlier
    if ((status === 'delivered' || status === 'fulfilled') && prevStatus !== status && shouldDecrementOnDelivery) {
      try { await inventoryService.reserveItems(asInventoryItems(order.items), req.user?._id || null); } catch (e) { console.warn('Delivery decrement failed:', e?.message || e); }
    }

    // Re-open flow: if an order was cancelled and moved back to pending,
    // reserve inventory again to reverse the previous cancel increment.
    if (prevStatus === 'cancelled' && status === 'pending' && shouldIncrementOnCancel && decrementedAtOrder) {
      try { await inventoryService.reserveItems(asInventoryItems(order.items), req.user?._id || null); } catch (e) { console.warn('Re-open decrement failed:', e?.message || e); }
    }

    // Auto-increment on cancel if it was decremented earlier
    const decrementedBeforeCancel = decrementedAtOrder || prevStatus === 'delivered' || prevStatus === 'fulfilled';
    if (status === 'cancelled' && prevStatus !== status && shouldIncrementOnCancel && decrementedBeforeCancel) {
      try { await inventoryService.incrementItems(asInventoryItems(order.items), req.user?._id || null, 'Order cancelled'); } catch (e) { console.warn('Cancel increment failed:', e?.message || e); }
    }

    // Hard fallback: when order is cancelled, force absolute MCG sync for affected products
    // even if increment was skipped due settings/state.
    if (status === 'cancelled' && prevStatus !== status) {
      const touchedProducts = Array.from(new Set((order.items || []).map(it => String(it.product || '')).filter(Boolean)));
      for (const pid of touchedProducts) {
        try { await inventoryService.pushMcgForEntireProduct(pid); } catch (e) { console.warn('Cancel MCG force-push failed:', e?.message || e); }
      }
    }

    // Auto-increment on returned
    if (status === 'returned' && prevStatus !== status && shouldIncrementOnReturn) {
      try { await inventoryService.incrementItems(asInventoryItems(order.items), req.user?._id || null, 'Order returned'); } catch (e) { console.warn('Return increment failed:', e?.message || e); }
    }

    // Emit real-time event for order update
    try { realTimeEventService.emitOrderUpdate(order); } catch (e) { console.warn('Failed to emit order update event:', e?.message || e); }

    res.json({
      message: 'Order status updated successfully',
      order
    });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ message: 'Failed to update order status', error: error?.message });
  }
};

// Request delivery assignment for user's own order
export const requestDeliveryAssignment = async (req, res) => {
  return res.status(400).json({ 
    message: 'Delivery company assignment is no longer available' 
  });
};

// Recalculate shipping for an existing order (admin)
export const recalculateShipping = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const city = order.shippingAddress?.city;
    const country = order.shippingAddress?.country;
    const areaGroup = order.shippingAddress?.areaGroup;
    if (!city || !country) {
      return res.status(400).json({ message: 'Order missing shipping address' });
    }

    const subtotal = order.totalAmount || order.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    let newFee = order.shippingFee || 0;
    try {
      newFee = await calcShipFee({ subtotal, weight: 0, country, region: areaGroup || undefined, city });
    } catch (e) {
      return res.status(400).json({ message: 'Failed to calculate shipping', error: e?.message });
    }

    order.shippingFee = newFee;
    order.deliveryFee = newFee;
    order.shippingCity = city;
    order.shippingCalculation = {
      subtotal,
      country,
      city,
      areaGroup,
      weight: 0,
      recalculatedAt: new Date()
    };
    await order.save();

    res.json({
      message: 'Shipping recalculated',
      shippingFee: newFee,
      orderId: order._id
    });
  } catch (error) {
    console.error('Error recalculating shipping:', error);
    res.status(500).json({ message: 'Failed to recalculate shipping' });
  }
};