import express from 'express';
import { adminAuth } from '../middleware/auth.js';
import { listForms } from '../controllers/formController.js';

const router = express.Router();

router.get('/', adminAuth, listForms);

export default router;
