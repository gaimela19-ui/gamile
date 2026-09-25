import { convertPrice, validateCurrency } from '../utils/currency.js';

export const convertCurrency = async (req, res) => {
  try {
    const { amount, from, to } = req.body;

    if (!amount || !from || !to) {
      return res.status(400).json({ 
        message: 'Amount, source currency, and target currency are required' 
      });
    }

    if (!validateCurrency(from) || !validateCurrency(to)) {
      return res.status(400).json({ message: 'Invalid currency' });
    }

    const convertedAmount = convertPrice(amount, from, to);
    
    res.json({
      convertedAmount,
      fromCurrency: from,
      toCurrency: to,
      exchangeRate: convertedAmount / amount
    });
  } catch (error) {
    console.error('Currency conversion error:', error);
    res.status(500).json({ message: 'Currency conversion failed' });
  }
};