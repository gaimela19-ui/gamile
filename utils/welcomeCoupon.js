import Settings from '../models/Settings.js';

export const getWelcomeCouponCode = async () => {
  try {
    const settings = await Settings.findOne().select('visitorPopup.couponCode');
    const raw = (settings?.visitorPopup?.couponCode || process.env.WELCOME_COUPON_CODE || '').toString().trim();
    return raw ? raw.toUpperCase() : '';
  } catch {
    return '';
  }
};
