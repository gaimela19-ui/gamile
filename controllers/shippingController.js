import ShippingZone from '../models/ShippingZone.js';
import ShippingRate from '../models/ShippingRate.js';
import { calculateShippingFee as calculateFee, getAvailableShippingOptions } from '../services/shippingService.js';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../utils/ApiError.js';
import XLSX from 'xlsx';

// Zone Controllers
export const getShippingZones = async (req, res) => {
  try {
    const zones = await ShippingZone.find().sort('order');
    res.json(zones);
  } catch (error) {
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to fetch shipping zones');
  }
};

export const getShippingZone = async (req, res) => {
  try {
    const zone = await ShippingZone.findById(req.params.id);
    if (!zone) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Shipping zone not found');
    }
    res.json(zone);
  } catch (error) {
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to fetch shipping zone');
  }
};

export const createShippingZone = async (req, res) => {
  try {
    const zone = new ShippingZone(req.body);
    await zone.save();
    res.status(StatusCodes.CREATED).json(zone);
  } catch (error) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to create shipping zone');
  }
};

export const updateShippingZone = async (req, res) => {
  try {
    const zone = await ShippingZone.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!zone) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Shipping zone not found');
    }
    res.json(zone);
  } catch (error) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to update shipping zone');
  }
};

export const deleteShippingZone = async (req, res) => {
  try {
    const zone = await ShippingZone.findByIdAndDelete(req.params.id);
    if (!zone) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Shipping zone not found');
    }
    res.json({ message: 'Shipping zone deleted successfully' });
  } catch (error) {
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to delete shipping zone');
  }
};

// Rate Controllers
export const getShippingRates = async (req, res) => {
  try {
    const rates = await ShippingRate.find()
      .populate('zone')
      .sort('zone');
    res.json(rates);
  } catch (error) {
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to fetch shipping rates');
  }
};

export const getShippingRate = async (req, res) => {
  try {
    const rate = await ShippingRate.findById(req.params.id)
      .populate('zone');
    if (!rate) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Shipping rate not found');
    }
    res.json(rate);
  } catch (error) {
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to fetch shipping rate');
  }
};

export const createShippingRate = async (req, res) => {
  try {
    const rate = new ShippingRate(req.body);
    await rate.save();
    res.status(StatusCodes.CREATED).json(rate);
  } catch (error) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to create shipping rate');
  }
};

export const updateShippingRate = async (req, res) => {
  try {
    const rate = await ShippingRate.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!rate) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Shipping rate not found');
    }
    res.json(rate);
  } catch (error) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Failed to update shipping rate');
  }
};

export const deleteShippingRate = async (req, res) => {
  try {
    const rate = await ShippingRate.findByIdAndDelete(req.params.id);
    if (!rate) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Shipping rate not found');
    }
    res.json({ message: 'Shipping rate deleted successfully' });
  } catch (error) {
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to delete shipping rate');
  }
};

// Fee Calculation
export const calculateShippingFee = async (req, res) => {
  try {
    const { subtotal, weight, country, region, areaGroup, city } = req.body;
    const fee = await calculateFee({ subtotal, weight, country, region, areaGroup, city });
    res.json({ fee, cityApplied: !!city });
  } catch (error) {
    throw new ApiError(StatusCodes.BAD_REQUEST, error.message || 'Failed to calculate shipping fee');
  }
};

// Get options (including city overrides) for UI selection
export const getShippingOptions = async (req, res) => {
  try {
    const { country, region, areaGroup, city, subtotal, weight } = req.query;
    const options = await getAvailableShippingOptions({ country, region, areaGroup, city, subtotal: Number(subtotal) || 0, weight: Number(weight) || 0 });
    res.json({ options });
  } catch (error) {
    throw new ApiError(StatusCodes.BAD_REQUEST, error.message || 'Failed to get shipping options');
  }
};

// List distinct cities configured in any ShippingRate (for settings screen)
export const getConfiguredCities = async (req, res) => {
  try {
    const rates = await ShippingRate.find({ 'cities.0': { $exists: true } }, { cities: 1 });
    const citySet = new Set();
    rates.forEach(r => (r.cities || []).forEach(c => c.name && citySet.add(c.name)));
    res.json({ cities: Array.from(citySet).sort() });
  } catch (error) {
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to fetch cities');
  }
};

export const importShippingZoneFromExcel = async (req, res) => {
  try {
    if (!req.file?.buffer) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Excel file is required');
    }

    const zoneName = (req.body.zoneName || req.body.name || '').trim();
    if (!zoneName) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Zone name is required');
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const [firstSheetName] = workbook.SheetNames;
    if (!firstSheetName) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'No worksheets found in the uploaded file');
    }
    const worksheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null });

    const parsedCities = parseCityRows(rows);
    if (parsedCities.length === 0) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'No valid city rows found in the spreadsheet');
    }

    const overwrite = parseBoolean(req.body.overwrite ?? req.body.replaceExisting, false);
    const regions = parseRegionsInput(req.body.regions);
    const zoneDescription = (req.body.zoneDescription || req.body.description || '').trim() || undefined;
    const zoneIsActive = parseBoolean(req.body.zoneActive ?? req.body.isActive, true);
    const zoneOrder = toNumber(req.body.zoneOrder, 0);

    let zone = await ShippingZone.findOne({ name: zoneName });
    const zonePayload = {
      name: zoneName,
      description: zoneDescription,
      countries: parsedCities.map(entry => entry.name),
      regions,
      isActive: zoneIsActive,
      order: zoneOrder,
      zonePrice: null
    };

    if (zone) {
      if (!overwrite) {
        throw new ApiError(StatusCodes.CONFLICT, 'Shipping zone already exists. Enable overwrite to replace it.');
      }
      zone.set(zonePayload);
      await zone.save();
      await ShippingRate.deleteMany({ zone: zone._id });
    } else {
      zone = await ShippingZone.create(zonePayload);
    }

    const rateName = (req.body.rateName || `${zoneName} Delivery`).trim();
    const rateDescription = (req.body.rateDescription || 'Imported from Excel').trim();
    const rateActive = parseBoolean(req.body.rateActive ?? req.body.isActiveRate, true);
    const rateOrder = toNumber(req.body.rateOrder, 0);
    const baseCost = parsedCities.find(city => typeof city.cost === 'number')?.cost ?? 0;

    const rate = await ShippingRate.create({
      zone: zone._id,
      name: rateName,
      description: rateDescription,
      method: 'flat_rate',
      cost: baseCost,
      cities: parsedCities,
      conditions: {
        minOrderValue: 0
      },
      isActive: rateActive,
      order: rateOrder
    });

    res.status(StatusCodes.CREATED).json({
      message: 'Shipping zone imported successfully',
      zone,
      rate,
      cityCount: parsedCities.length
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    console.error('Failed to import shipping zone from Excel:', error);
    throw new ApiError(StatusCodes.BAD_REQUEST, error.message || 'Failed to import shipping zone');
  }
};

function parseCityRows(rows = []) {
  const entries = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const normalized = Object.entries(row).reduce((acc, [key, value]) => {
      const k = (key || '').toString().trim().toLowerCase();
      if (!k) return acc;
      acc[k] = value;
      return acc;
    }, {});

    const city = (normalized.city || normalized['city name'] || normalized.name || normalized['town'] || normalized['المدينة'] || '').toString().trim();
    if (!city) continue;

    const priceValue = normalized.price ?? normalized.cost ?? normalized.amount ?? normalized.rate ?? normalized['delivery fee'] ?? null;
    const cost = parseNumeric(priceValue);
    entries.push({ name: city, cost });
  }

  const deduped = new Map();
  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    deduped.set(key, entry);
  }
  return Array.from(deduped.values());
}

function parseRegionsInput(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map(r => (r || '').toString().trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        return parsed.map(r => (r || '').toString().trim()).filter(Boolean);
      }
    } catch {
      // not JSON, continue
    }
    return input.split(',').map(r => r.trim()).filter(Boolean);
  }
  return [];
}

function parseNumeric(value) {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  let str = value.toString().trim();
  if (!str) return undefined;
  str = str.replace(/[^0-9.,-]/g, '');
  if (!str) return undefined;
  if (str.includes('.') && str.includes(',')) {
    str = str.replace(/,/g, '');
  } else if (str.includes(',') && !str.includes('.')) {
    str = str.replace(',', '.');
  } else {
    str = str.replace(/,/g, '');
  }
  const num = Number(str);
  return Number.isFinite(num) ? num : undefined;
}

function parseBoolean(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = value.toString().trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function toNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}
