import asyncHandler from 'express-async-handler';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import PaymentSession from '../models/PaymentSession.js';
import { finalizePaymentSessionToOrder, createPaymentSessionDocument } from '../services/paymentSessionService.js';
import { createSession, getSessionStatus, resendNotification } from '../services/zcreditService.js';

function deriveOrigin(req) {
  const headers = req?.headers || {};
  if (headers.origin) return headers.origin.replace(/\/$/, '');
  if (headers.referer) {
    try {
      const url = new URL(headers.referer);
      return `${url.protocol}//${url.host}`;
    } catch {}
  }
  const host = headers['x-forwarded-host'] || headers.host;
  if (!host) return '';
  const proto = (headers['x-forwarded-proto'] || '').split(',')[0] || (req?.protocol || 'https');
  return `${proto}://${host}`.replace(/\/$/, '');
}

function deriveServerBase(req) {
  const headers = req?.headers || {};
  const hostHeader = headers['x-forwarded-host'] || headers.host || '';
  const host = typeof hostHeader === 'string' ? hostHeader.split(',')[0].trim() : '';
  if (!host) return '';
  const protoHeader = headers['x-forwarded-proto'] || '';
  const protocol = protoHeader.split(',')[0] || req?.protocol || 'https';
  return `${protocol}://${host}`.replace(/\/$/, '');
}

function buildDefaultUrls(req) {
  const requestOrigin = deriveOrigin(req) || '';
  const serverBase = deriveServerBase(req) || '';
  const publicBase = (process.env.PUBLIC_WEB_URL || requestOrigin || '').replace(/\/$/, '');
  const apiBase = (process.env.PUBLIC_API_URL || serverBase || publicBase || '').replace(/\/$/, '');
  const successBase = publicBase || serverBase;
  const defaultSuccess = successBase ? `${successBase}/checkout/success` : '';
  const defaultCancel = successBase ? `${successBase}/checkout/cancel` : '';
  const defaultSuccessCb = apiBase ? `${apiBase}/api/zcredit/callback/success` : '';
  const defaultFailureCb = apiBase ? `${apiBase}/api/zcredit/callback/failure` : '';
  return { defaultSuccess, defaultCancel, defaultSuccessCb, defaultFailureCb, publicBase, apiBase, serverBase };
}

function sanitizeCheckoutItems(items) {
  if (!Array.isArray(items)) return [];
  const isHex24 = (s) => typeof s === 'string' && /^[0-9a-fA-F]{24}$/.test(s);
  return items.map((it) => ({
    product: isHex24(it.product) ? it.product : undefined,
    quantity: Number(it.quantity) || 0,
    price: Number(it.price) || undefined,
    size: it.size,
    color: typeof it.color === 'string' ? it.color : (it.color?.name || it.color?.code || undefined),
    variantId: isHex24(it.variantId) ? it.variantId : undefined,
    sku: it.sku,
    variants: Array.isArray(it.variants)
      ? it.variants.map((v) => ({
        attributeId: isHex24(v.attributeId || v.attribute) ? (v.attributeId || v.attribute) : undefined,
        attributeName: v.attributeName || v.name || undefined,
        valueId: isHex24(v.valueId || v.value) ? (v.valueId || v.value) : undefined,
        valueName: v.valueName || v.valueLabel || v.label || undefined
      }))
      : undefined
  }));
}

function parseGiftCardPayload(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const code = String(raw.code || '').trim();
  const amount = Number(raw.amount);
  if (!code || !Number.isFinite(amount) || amount <= 0) return undefined;
  return { code, amount };
}

async function calculatePricingSummary(items, currency) {
  const summary = { subtotal: 0 };
  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) {
      throw new Error('invalid_quantity');
    }
    let unitPrice = undefined;
    // Prefer client-provided price to avoid DB dependency/timeouts
    const provided = Number(item.price);
    if (Number.isFinite(provided) && provided > 0) {
      unitPrice = provided;
    } else if (item.product) {
      // Fallback to DB price only when no valid client price was provided
      const product = await Product.findById(item.product);
      if (product) {
        unitPrice = Number(product.price);
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
          throw new Error(`Invalid price for product ${product._id}`);
        }
      } else {
        throw new Error(`Product not found and no valid price provided: ${item.product}`);
      }
    } else {
      throw new Error('missing_product_and_price');
    }

    summary.subtotal += unitPrice * qty;
  }
  summary.currency = currency;
  return summary;
}

function buildSessionUrlSet(req, sessionId) {
  const { publicBase, apiBase, serverBase } = buildDefaultUrls(req);
  const successBase = publicBase || serverBase;
  const success = successBase ? `${successBase}/payment/return?session=${sessionId}` : '';
  const cancel = successBase ? `${successBase}/cart` : '';
  const callback = apiBase ? `${apiBase}/api/zcredit/callback/success` : '';
  const failureCallback = apiBase ? `${apiBase}/api/zcredit/callback/failure` : '';
  return { success, cancel, callback, failureCallback };
}

function buildPaymentDetailsFromCallback(body) {
  return {
    gateway: 'zcredit',
    zcredit: {
      SessionId: body?.SessionId,
      ReferenceNumber: body?.ReferenceNumber,
      ApprovalNumber: body?.ApprovalNumber,
      Token: body?.Token,
      VoucherNumber: body?.VoucherNumber,
      InvoiceRecieptDocumentNumber: body?.InvoiceRecieptDocumentNumber,
      InvoiceRecieptNumber: body?.InvoiceRecieptNumber,
      CardNum: body?.CardNum,
      ExpDate_MMYY: body?.ExpDate_MMYY,
      PaymentMethod: body?.PaymentMethod,
      Raw: body
    }
  };
}

export const createSessionHandler = asyncHandler(async (req, res) => {
  const {
    uniqueId,
    orderNumber,
    cartItems,
    orderTotal,
    customer,
    paymentType = 'regular',
    installments,
    currency: reqCurrency,
    successUrl,
    cancelUrl,
    callbackUrl,
    failureCallbackUrl,
    failureRedirectUrl,
    numberOfFailures
  } = req.body || {};

  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    res.status(400).json({ message: 'cartItems required' });
    return;
  }

  const { defaultSuccess, defaultCancel, defaultSuccessCb, defaultFailureCb } = buildDefaultUrls(req);

  // Normalize amounts and cart to include Order Total (if provided)
  const fallbackCurrency = (typeof reqCurrency === 'string' && reqCurrency) || process.env.STORE_CURRENCY || 'ILS';
  const normalizedCartItems = cartItems.map((it) => {
    const qty = Number(it?.Quantity ?? it?.quantity ?? 1) || 1;
    const amountRaw = it?.Amount ?? it?.amount ?? it?.Price ?? it?.price;
    const amt = Number(amountRaw);
    const amount = Number.isFinite(amt) && amt > 0 ? +amt.toFixed(2) : 0;
    const name = it?.Name || it?.name || 'Item';
    const desc = it?.Description || it?.description || '';
    let image = it?.Image || it?.image || '';
    const currency = it?.Currency || it?.currency || fallbackCurrency;
    if (typeof image === 'string') {
      image = image.trim();
      if (image) {
        if (image.startsWith('http://')) {
          image = 'https://' + image.slice('http://'.length);
        } else if (image.startsWith('/')) {
          const base = process.env.PUBLIC_WEB_URL || process.env.STORE_BASE_URL || ((req.protocol === 'https' ? 'https://' : 'http://') + req.get('host'));
          image = base.replace(/\/$/, '') + image;
        }
        if (!image.startsWith('https://')) {
          // If still not https, omit to avoid provider input error
          image = undefined;
        }
      } else {
        image = undefined;
      }
    } else {
      image = undefined;
    }
    return {
      Amount: amount,
      Currency: currency,
      Name: name,
      Description: desc,
      Quantity: qty,
      Image: image, // Will be omitted if undefined when serialized
      IsTaxFree: Boolean(it?.IsTaxFree ?? it?.isTaxFree ?? false),
      AdjustAmount: Boolean(it?.AdjustAmount ?? it?.adjustAmount ?? false)
    };
  });

  // If caller provided an explicit order total, prefer sending a single consolidated item
  let effectiveCart = normalizedCartItems;
  const explicitTotal = Number(orderTotal);
  if (Number.isFinite(explicitTotal) && explicitTotal > 0) {
    effectiveCart = [{
      Amount: +explicitTotal.toFixed(2),
      Currency: fallbackCurrency,
      Name: 'Order Total',
      Description: 'Full order total (including shipping/discounts)',
      Quantity: 1,
      IsTaxFree: false,
      AdjustAmount: false
    }];
  }

  // Final sanitization: drop any Image not strictly starting with https://
  for (const item of effectiveCart) {
    if (item.Image && !item.Image.startsWith('https://')) {
      delete item.Image;
    }
  }

  // Debug log (can be toggled off later)
  if (process.env.NODE_ENV !== 'production') {
    console.log('[zcredit][createSession] sanitized cart images:', effectiveCart.map(i => i.Image));
  }

  const total = effectiveCart.reduce((s, it) => s + (Number(it.Amount) || 0) * (Number(it.Quantity) || 0), 0);
  if (!(total > 0)) {
    return res.status(400).json({ message: 'Total cart amount must be greater than zero' });
  }

  // Cap NumberOfFailures per provider constraint (error when >5)
  const maxFailures = 5;
  const requestedFailures = typeof numberOfFailures === 'number' ? numberOfFailures : 99;
  const effectiveFailures = Math.min(Math.max(1, requestedFailures), maxFailures);
  if (requestedFailures !== effectiveFailures) {
    try { console.warn('[zcredit][createSession] Adjusted NumberOfFailures from %s to %s (provider cap=%s)', requestedFailures, effectiveFailures, maxFailures); } catch {}
  }

  // Sanitize redirect URLs (provider requires http/https)
  const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
  const safeSuccess = isHttp(successUrl) ? successUrl : (isHttp(defaultSuccess) ? defaultSuccess : undefined);
  const safeCancel = isHttp(cancelUrl) ? cancelUrl : undefined; // optional; omit if invalid

  const payload = {
    Local: req.body?.local || 'He',
    UniqueId: orderNumber || uniqueId || `wc_${Date.now()}`,
    SuccessUrl: safeSuccess,
    ...(safeCancel ? { CancelUrl: safeCancel } : {}),
    CallbackUrl: callbackUrl || defaultSuccessCb,
    FailureCallBackUrl: failureCallbackUrl || defaultFailureCb,
    FailureRedirectUrl: failureRedirectUrl || '',
    NumberOfFailures: effectiveFailures,
    PaymentType: paymentType,
    CreateInvoice: req.body?.createInvoice ?? true,
    AdditionalText: req.body?.additionalText || '',
    ShowCart: req.body?.showCart ?? true,
    ThemeColor: req.body?.themeColor || '005ebb',
    BitButtonEnabled: req.body?.bitButtonEnabled ?? true,
    ApplePayButtonEnabled: req.body?.applePayButtonEnabled ?? true,
    GooglePayButtonEnabled: req.body?.googlePayButtonEnabled ?? true,
    Installments: installments || undefined,
    Customer: customer || undefined,
    CartItems: effectiveCart,
    FocusType: req.body?.focusType || 'None',
    CardsIcons: req.body?.cardsIcons || undefined,
    IssuerWhiteList: req.body?.issuerWhiteList || undefined,
    BrandWhiteList: req.body?.brandWhiteList || undefined,
    UseLightMode: req.body?.useLightMode ?? false,
    UseCustomCSS: req.body?.useCustomCSS ?? false,
    BackgroundColor: req.body?.backgroundColor || 'FFFFFF',
    ShowTotalSumInPayButton: req.body?.showTotalSumInPayButton ?? true,
    ForceCaptcha: req.body?.forceCaptcha ?? false,
    CustomCSS: req.body?.customCSS || '',
    Bypass3DS: req.body?.bypass3DS ?? false
  };

  const data = await createSession(payload);
  res.json(data);
});

export const createSessionFromCartHandler = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const { items, shippingAddress, customerInfo } = body;
  try {
    console.log('[zcredit][session-from-cart] incoming', {
      itemsCount: Array.isArray(items) ? items.length : 0,
      shippingAddress: {
        street: shippingAddress?.street,
        city: shippingAddress?.city,
        country: shippingAddress?.country,
        areaGroup: shippingAddress?.areaGroup
      },
      customerInfo: {
        email: customerInfo?.email,
        mobile: customerInfo?.mobile
      },
      currency: body?.currency,
      shippingFee: body?.shippingFee,
      totalWithShipping: body?.totalWithShipping,
      coupon: body?.coupon?.code ? { code: body.coupon.code, discount: body.coupon.discount } : undefined,
      giftCard: body?.giftCard?.code ? { code: body.giftCard.code, amount: body.giftCard.amount } : undefined,
      successUrl: body?.successUrl,
      cancelUrl: body?.cancelUrl
    });
  } catch {}
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'items required' });
  }
  if (!shippingAddress?.street || !shippingAddress?.city || !shippingAddress?.country) {
    return res.status(400).json({ message: 'invalid_shipping' });
  }
  if (!customerInfo?.email || !customerInfo?.mobile) {
    return res.status(400).json({ message: 'invalid_customer' });
  }

  const currency = String(body.currency || process.env.STORE_CURRENCY || 'ILS');
  const normalizedItems = sanitizeCheckoutItems(items);
  let summary;
  try {
    summary = await calculatePricingSummary(normalizedItems, currency);
  } catch (err) {
    try { console.error('[zcredit][session-from-cart] pricing validation failed', err?.message || err); } catch {}
    const detail = err?.message || 'pricing_failed';
    return res.status(400).json({ message: 'pricing_failed', detail });
  }
  const couponInfo = body?.coupon?.code
    ? { code: String(body.coupon.code).trim(), discount: Math.max(0, Number(body.coupon.discount) || 0) }
    : undefined;
  const giftCardInfo = parseGiftCardPayload(body?.giftCard);

  let itemsTotal = summary.subtotal;
  if (couponInfo?.discount) {
    itemsTotal = Math.max(0, itemsTotal - couponInfo.discount);
  }

  const rawShippingFee = Number(body.shippingFee);
  const shippingFee = Number.isFinite(rawShippingFee) && rawShippingFee >= 0 ? rawShippingFee : 0;
  const totalWithShipping = itemsTotal + shippingFee;
  const giftDeduction = giftCardInfo?.amount || 0;
  const cardChargeAmount = Math.max(0, totalWithShipping - giftDeduction);
  try { console.log('[zcredit][session-from-cart] totals', { itemsTotal, shippingFee, totalWithShipping, giftDeduction, cardChargeAmount }); } catch {}
  if (!(cardChargeAmount > 0)) {
    return res.status(400).json({ message: 'card_charge_must_be_positive' });
  }

  const orderNumber = body?.orderNumber?.trim?.() ? String(body.orderNumber).trim() : `ORD${Date.now()}`;
  const session = await createPaymentSessionDocument({
    gateway: 'zcredit',
    status: 'created',
    reference: `ZC-${Date.now()}`,
    orderNumber,
    items: normalizedItems,
    shippingAddress: {
      street: shippingAddress.street,
      city: shippingAddress.city,
      country: shippingAddress.country,
      areaGroup: typeof shippingAddress.areaGroup === 'string' ? shippingAddress.areaGroup.trim() : ''
    },
    customerInfo: {
      firstName: customerInfo.firstName,
      lastName: customerInfo.lastName,
      email: customerInfo.email,
      mobile: customerInfo.mobile,
      secondaryMobile: customerInfo.secondaryMobile
    },
    coupon: couponInfo,
    giftCard: giftCardInfo,
    currency,
    shippingFee,
    totalWithShipping,
    cardChargeAmount
  });

  const { success, cancel, callback, failureCallback } = buildSessionUrlSet(req, session._id);
  const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);
  const appendSessionParams = (baseUrl) => {
    if (!baseUrl) return baseUrl;
    try {
      const url = new URL(baseUrl);
      url.searchParams.set('session', session._id.toString());
      url.searchParams.set('order', orderNumber);
      return url.toString();
    } catch {
      return baseUrl;
    }
  };
  const requestedSuccess = typeof body.successUrl === 'string' ? body.successUrl.trim() : '';
  const requestedCancel = typeof body.cancelUrl === 'string' ? body.cancelUrl.trim() : '';
  const requestedCallback = typeof body.callbackUrl === 'string' ? body.callbackUrl.trim() : '';
  const requestedFailureCallback = typeof body.failureCallbackUrl === 'string' ? body.failureCallbackUrl.trim() : '';

  const finalSuccessUrl = isHttp(requestedSuccess) ? appendSessionParams(requestedSuccess) : success;
  const finalCancelUrl = isHttp(requestedCancel) ? appendSessionParams(requestedCancel) : cancel;
  const finalCallbackUrl = isHttp(requestedCallback) ? requestedCallback : callback;
  const finalFailureCallbackUrl = isHttp(requestedFailureCallback) ? requestedFailureCallback : failureCallback;
  const requestedFailures = typeof body.numberOfFailures === 'number' ? body.numberOfFailures : 3;
  const effectiveFailures = Math.min(Math.max(1, requestedFailures), 5);
  const customerPayload = {
    Name: `${customerInfo.firstName || ''} ${customerInfo.lastName || ''}`.trim(),
    Email: customerInfo.email,
    Phone: customerInfo.mobile
  };

  const payload = {
    Local: body?.local || 'He',
    UniqueId: orderNumber,
    SuccessUrl: finalSuccessUrl || undefined,
    ...(finalCancelUrl ? { CancelUrl: finalCancelUrl } : {}),
    CallbackUrl: finalCallbackUrl || '',
    FailureCallBackUrl: finalFailureCallbackUrl || '',
    NumberOfFailures: effectiveFailures,
    PaymentType: body?.paymentType || 'regular',
    CreateInvoice: body?.createInvoice ?? true,
    ShowCart: false,
    Installments: body?.installments || undefined,
    Customer: customerPayload,
    CartItems: [{
      Amount: +cardChargeAmount.toFixed(2),
      Currency: currency,
      Name: 'Order Total',
      Description: 'Checkout total after discounts',
      Quantity: 1,
      IsTaxFree: false,
      AdjustAmount: false
    }]
  };

  try {
    const data = await createSession(payload);
    const sessionUrl = data?.Data?.SessionUrl || data?.SessionUrl || data?.Data?.sessionUrl || data?.sessionUrl;
    const providerSessionId = data?.Data?.SessionId || data?.SessionId;
    session.paymentDetails = {
      gateway: 'zcredit',
      zcredit: {
        SessionId: providerSessionId,
        SessionUrl: sessionUrl,
        CardChargeAmount: cardChargeAmount
      }
    };
    session.reference = orderNumber;
    await session.save();
    return res.json({
      ok: true,
      sessionUrl,
      sessionId: session._id,
      orderNumber,
      cardChargeAmount,
      totalWithShipping
    });
  } catch (e) {
    try { console.error('[zcredit][session-from-cart] failed', e?.message || e); } catch {}
    return res.status(400).json({ message: 'session_failed', detail: e?.message || String(e) });
  }
});

export const getStatusHandler = asyncHandler(async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) {
    res.status(400).json({ message: 'sessionId required' });
    return;
  }
  const data = await getSessionStatus(sessionId);
  res.json(data);
});

export const confirmSessionHandler = asyncHandler(async (req, res) => {
  const sessionId = String(req.body?.sessionId || '').trim();
  if (!sessionId) {
    return res.status(400).json({ message: 'sessionId required' });
  }
  const session = await PaymentSession.findById(sessionId);
  if (!session) {
    return res.status(404).json({ message: 'session_not_found' });
  }
  if (session.gateway !== 'zcredit') {
    return res.status(400).json({ message: 'invalid_gateway' });
  }

  if (session.orderId) {
    const existing = await Order.findById(session.orderId);
    if (existing) {
      return res.json({ ok: true, order: { _id: existing._id, orderNumber: existing.orderNumber, paymentStatus: existing.paymentStatus } });
    }
  }

  const providerSessionId = session.paymentDetails?.zcredit?.SessionId || String(req.body?.gatewaySessionId || '').trim();
  if (!providerSessionId) {
    return res.status(400).json({ message: 'gateway_session_missing' });
  }

  let statusPayload;
  try {
    statusPayload = await getSessionStatus(providerSessionId);
  } catch (err) {
    return res.status(400).json({ message: 'status_lookup_failed', detail: err?.message || String(err) });
  }

  if (!statusPayload?.TransactionSuccess) {
    return res.status(409).json({ message: 'transaction_not_successful', detail: statusPayload?.ReturnMessage || 'pending' });
  }

  let callbackJson = null;
  try {
    if (statusPayload?.CallBackJSON) {
      callbackJson = JSON.parse(statusPayload.CallBackJSON);
    }
  } catch {}

  const paymentDetails = {
    gateway: 'zcredit',
    zcredit: {
      SessionId: providerSessionId,
      Status: statusPayload,
      Callback: callbackJson
    }
  };

  const { order } = await finalizePaymentSessionToOrder(session, {
    paymentMethod: 'card',
    paymentStatus: 'completed',
    paymentDetails
  });

  try {
    const { realTimeEventService } = await import('../services/realTimeEventService.js');
    realTimeEventService.emitOrderUpdate(order);
  } catch {}

  return res.json({ ok: true, order: { _id: order._id, orderNumber: order.orderNumber, paymentStatus: order.paymentStatus } });
});

export const resendNotificationHandler = asyncHandler(async (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) {
    res.status(400).json({ message: 'sessionId required' });
    return;
  }
  const data = await resendNotification(sessionId);
  res.json(data);
});

export const getSessionOrderHandler = asyncHandler(async (req, res) => {
  const sessionId = String(req.params?.sessionId || '').trim();
  if (!sessionId) {
    return res.status(400).json({ message: 'sessionId required' });
  }
  const session = await PaymentSession.findById(sessionId);
  if (!session) {
    return res.status(404).json({ message: 'session_not_found' });
  }
  let orderPayload = null;
  if (session.orderId) {
    const order = await Order.findById(session.orderId);
    if (order) {
      orderPayload = {
        _id: order._id,
        orderNumber: order.orderNumber,
        paymentStatus: order.paymentStatus,
        status: order.status
      };
    }
  }
  return res.json({
    ok: true,
    session: {
      id: session._id,
      gateway: session.gateway,
      status: session.status,
      orderNumber: session.orderNumber,
      cardChargeAmount: session.cardChargeAmount
    },
    order: orderPayload
  });
});

export const createInvoiceFromOrderHandler = asyncHandler(async (req, res) => {
  const orderId = String(req.params?.orderId || '').trim();
  if (!orderId) {
    return res.status(400).json({ message: 'orderId required' });
  }

  const order = await Order.findById(orderId);
  if (!order) {
    return res.status(404).json({ message: 'order_not_found' });
  }

  const currency = order.currency || process.env.STORE_CURRENCY || 'ILS';
  const shippingFee = Number.isFinite(Number(order.shippingFee))
    ? Number(order.shippingFee)
    : Number(order.deliveryFee) || 0;
  const subtotal = Number(order.totalAmount) || 0;
  const cardChargeAmount = +(subtotal + Math.max(0, shippingFee)).toFixed(2);
  if (!(cardChargeAmount > 0)) {
    return res.status(400).json({ message: 'invalid_order_total' });
  }

  const customer = order.customerInfo || {};
  if (!customer.email || !customer.mobile) {
    return res.status(400).json({ message: 'order_missing_customer_info' });
  }

  const { defaultSuccess, defaultCancel, defaultSuccessCb, defaultFailureCb } = buildDefaultUrls(req);
  const payload = {
    Local: 'He',
    UniqueId: order.orderNumber,
    SuccessUrl: defaultSuccess || undefined,
    ...(defaultCancel ? { CancelUrl: defaultCancel } : {}),
    CallbackUrl: defaultSuccessCb || '',
    FailureCallBackUrl: defaultFailureCb || '',
    NumberOfFailures: 3,
    PaymentType: 'regular',
    CreateInvoice: true,
    AdditionalText: `Admin invoice creation for order ${order.orderNumber}`,
    ShowCart: false,
    Customer: {
      Name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.email,
      Email: customer.email,
      Phone: customer.mobile
    },
    CartItems: [{
      Amount: cardChargeAmount,
      Currency: currency,
      Name: `Order ${order.orderNumber}`,
      Description: 'Admin initiated invoice payment',
      Quantity: 1,
      IsTaxFree: false,
      AdjustAmount: false
    }]
  };

  let data;
  try {
    data = await createSession(payload);
  } catch (err) {
    return res.status(400).json({
      message: 'zcredit_invoice_failed',
      detail: err?.message || String(err)
    });
  }

  const sessionUrl = data?.Data?.SessionUrl || data?.SessionUrl;
  const providerSessionId = data?.Data?.SessionId || data?.SessionId;
  if (!sessionUrl || !providerSessionId) {
    return res.status(502).json({ message: 'zcredit_session_missing' });
  }

  const snapshot = {
    sessionId: providerSessionId,
    sessionUrl,
    createdAt: new Date().toISOString(),
    amount: cardChargeAmount,
    currency
  };

  const details = order.paymentDetails && typeof order.paymentDetails === 'object'
    ? { ...order.paymentDetails }
    : {};
  const priorSessions = Array.isArray(details.zcreditInvoiceSessions)
    ? [...details.zcreditInvoiceSessions]
    : [];
  priorSessions.push(snapshot);
  details.zcreditInvoiceSessions = priorSessions;
  order.paymentDetails = details;
  order.markModified('paymentDetails');
  await order.save();

  return res.json({
    ok: true,
    orderId: order._id,
    orderNumber: order.orderNumber,
    sessionId: providerSessionId,
    sessionUrl,
    amount: cardChargeAmount,
    currency
  });
});

export const successCallbackHandler = asyncHandler(async (req, res) => {
  try {
    console.log('[zcredit][callback][success]', JSON.stringify(req.body));
  } catch {}

  // Attempt to reconcile with existing order using UniqueID -> orderNumber
  if (process.env.SKIP_DB === '1') {
    return res.json({ ok: true, note: 'SKIP_DB=1; reconciliation skipped' });
  }

  try {
    const uid = req.body?.UniqueID || req.body?.UniqueId || req.body?.uniqueId || '';
    if (!uid) {
      return res.json({ ok: true, warning: 'UniqueID missing in callback; order reconciliation skipped' });
    }
    let order = await Order.findOne({ orderNumber: uid });
    const paymentDetails = buildPaymentDetailsFromCallback(req.body);

    if (!order) {
      const session = await PaymentSession.findOne({ orderNumber: uid, gateway: 'zcredit' });
      if (session) {
        const { order: created } = await finalizePaymentSessionToOrder(session, {
          paymentMethod: 'card',
          paymentStatus: 'completed',
          paymentDetails
        });
        order = created;
      } else {
        return res.json({ ok: true, warning: `Order not found by orderNumber=${uid}` });
      }
    } else {
      order.paymentMethod = order.paymentMethod || 'card';
      order.paymentStatus = 'completed';
      order.paymentReference = req.body?.ReferenceNumber || order.paymentReference;
      order.paymentDetails = paymentDetails;
      await order.save();
    }

    try {
      const { realTimeEventService } = await import('../services/realTimeEventService.js');
      realTimeEventService.emitOrderUpdate(order);
    } catch {}

    return res.json({ ok: true, orderId: order._id, orderNumber: order.orderNumber });
  } catch (e) {
    console.error('[zcredit][callback][success][reconcile] error', e?.message || e);
    // Always 200 for provider; include note
    return res.json({ ok: true, error: 'reconcile_failed' });
  }
});

export const failureCallbackHandler = asyncHandler(async (req, res) => {
  try {
    console.warn('[zcredit][callback][failure]', JSON.stringify(req.body));
  } catch {}

  if (process.env.SKIP_DB === '1') {
    return res.json({ ok: true, note: 'SKIP_DB=1; reconciliation skipped' });
  }

  try {
    const uid = req.body?.UniqueID || req.body?.UniqueId || req.body?.uniqueId || '';
    if (!uid) {
      return res.json({ ok: true, warning: 'UniqueID missing in failure callback; order reconciliation skipped' });
    }
    const order = await Order.findOne({ orderNumber: uid });
    if (!order) {
      const session = await PaymentSession.findOne({ orderNumber: uid, gateway: 'zcredit' });
      if (session) {
        session.status = 'failed';
        session.paymentDetails = {
          ...(session.paymentDetails || {}),
          gateway: 'zcredit',
          zcreditFailure: {
            ReturnCode: req.body?.ReturnCode,
            ReturnMessage: req.body?.ReturnMessage
          }
        };
        await session.save();
        return res.json({ ok: true, warning: `Order not yet created for orderNumber=${uid}` });
      }
      return res.json({ ok: true, warning: `Order not found by orderNumber=${uid}` });
    }
    order.paymentStatus = 'failed';
    order.paymentDetails = {
      gateway: 'zcredit',
      zcreditFailure: {
        ReturnCode: req.body?.ReturnCode,
        ReturnMessage: req.body?.ReturnMessage
      }
    };
    await order.save();
    try {
      const { realTimeEventService } = await import('../services/realTimeEventService.js');
      realTimeEventService.emitOrderUpdate(order);
    } catch {}
    return res.json({ ok: true, orderId: order._id, orderNumber: order.orderNumber });
  } catch (e) {
    console.error('[zcredit][callback][failure][reconcile] error', e?.message || e);
    return res.json({ ok: true, error: 'reconcile_failed' });
  }
});

export default {
  createSessionHandler,
  createSessionFromCartHandler,
  getStatusHandler,
  getSessionOrderHandler,
  createInvoiceFromOrderHandler,
  confirmSessionHandler,
  resendNotificationHandler,
  successCallbackHandler,
  failureCallbackHandler
};
