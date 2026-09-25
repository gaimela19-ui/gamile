import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import {
  listAttributes,
  getAttribute,
  createAttribute,
  updateAttribute,
  deleteAttribute,
  listValues,
  createValue,
  updateValue,
  deleteValue,
  getAttributeI18n,
  setAttributeI18n,
  getAttributeValueI18n,
  setAttributeValueI18n
} from '../controllers/attributeController.js';

const router = express.Router();

// Attribute CRUD
// Attribute CRUD
// Public read endpoints
router.get('/', listAttributes);
router.get('/:id', getAttribute);
router.post('/', adminAuth, createAttribute);
router.put('/:id', adminAuth, updateAttribute);
router.delete('/:id', adminAuth, deleteAttribute);

// Values nested under attribute
// Public read for values
router.get('/:attributeId/values', listValues);
router.post('/:attributeId/values', adminAuth, createValue);
// Manage individual value by id
router.put('/values/:id', adminAuth, updateValue);
router.delete('/values/:id', adminAuth, deleteValue);

// i18n admin
router.get('/:id/i18n', adminAuth, getAttributeI18n);
router.put('/:id/i18n', adminAuth, setAttributeI18n);
router.get('/:attributeId/values/:valueId/i18n', adminAuth, getAttributeValueI18n);
router.put('/:attributeId/values/:valueId/i18n', adminAuth, setAttributeValueI18n);

export default router;
