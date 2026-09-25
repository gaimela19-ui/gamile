import express from 'express';
import userRoutes from './userRoutes.js';
import productRoutes from './productRoutes.js';
import orderRoutes from './orderRoutes.js';
import authRoutes from './authRoutes.js';
import heroRoutes from './heroRoutes.js';
import settingsRoutes from './settingsRoutes.js';
import categoryRoutes from './categoryRoutes.js';
import navigationCategoryRoutes from './navigationCategoryRoutes.js';
import deliveryRoutes from './deliveryRoutes.js';
import currencyRoutes from './currencyRoutes.js';
import footerRoutes from './footerRoutes.js';
import announcementRoutes from './announcementRoutes.js';
import backgroundRoutes from './backgroundRoutes.js';
import bannerRoutes from './bannerRoutes.js';
import uploadRoutes from './uploadRoutes.js';
import attributeRoutes from './attributeRoutes.js';
import posRoutes from './posRoutes.js';



import warehouseRoutes from './warehouseRoutes.js';
import inventoryRoutes from './inventoryRoutes.js';
import warehouseMovementRoutes from './warehouseMovementRoutes.js';

import giftCardRoutes from './giftCardRoutes.js';
import couponRoutes from './couponRoutes.js';
import recipientRoutes from './recipientRoutes.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/products', productRoutes);
router.use('/orders', orderRoutes);
router.use('/hero', heroRoutes);
router.use('/settings', settingsRoutes);
router.use('/categories', categoryRoutes);
router.use('/navigation-categories', navigationCategoryRoutes);
router.use('/delivery', deliveryRoutes);
router.use('/currency', currencyRoutes);
router.use('/footer', footerRoutes);
router.use('/announcements', announcementRoutes);
router.use('/backgrounds', backgroundRoutes);
router.use('/banners', bannerRoutes);
router.use('/uploads', uploadRoutes);
router.use('/attributes', attributeRoutes);
router.use('/pos', posRoutes);

router.use('/inventory', inventoryRoutes);

router.use('/warehouses', warehouseRoutes);
router.use('/warehouse-movements', warehouseMovementRoutes);

router.use('/gift-cards', giftCardRoutes);
router.use('/coupons', couponRoutes);
router.use('/recipients', recipientRoutes);

export default router;