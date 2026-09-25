import asyncHandler from 'express-async-handler';
import {
  commitTokenTransaction,
  commitCardTransaction,
  captureAuthorized,
  refundTransaction
} from '../services/zcreditGatewayService.js';

export const commitTokenHandler = asyncHandler(async (req, res) => {
  const { token, amount, currency, uniqueId, transactionType } = req.body || {};
  const data = await commitTokenTransaction({ token, amount, currency, uniqueId, transactionType });
  res.json(data);
});

export const commitCardHandler = asyncHandler(async (req, res) => {
  const { cardNumber, expMonth, expYear, cvv, holderId, amount, currency, uniqueId, transactionType } = req.body || {};
  const data = await commitCardTransaction({ cardNumber, expMonth, expYear, cvv, holderId, amount, currency, uniqueId, transactionType });
  res.json(data);
});

export const captureHandler = asyncHandler(async (req, res) => {
  const { referenceNumber, amount } = req.body || {};
  const data = await captureAuthorized({ referenceNumber, amount });
  res.json(data);
});

export const refundHandler = asyncHandler(async (req, res) => {
  const { referenceNumber, amount } = req.body || {};
  const data = await refundTransaction({ referenceNumber, amount });
  res.json(data);
});

export const gatewayHealthHandler = asyncHandler(async (req, res) => {
  const missing = [];
  if (!process.env.ZCREDIT_TERMINAL_NUMBER) missing.push('ZCREDIT_TERMINAL_NUMBER');
  if (!process.env.ZCREDIT_TERMINAL_PASSWORD) missing.push('ZCREDIT_TERMINAL_PASSWORD');
  if (!process.env.ZCREDIT_GATEWAY_URL) missing.push('ZCREDIT_GATEWAY_URL');
  res.json({ ok: missing.length === 0, missing });
});

export default {
  commitTokenHandler,
  commitCardHandler,
  captureHandler,
  refundHandler,
  gatewayHealthHandler
};
