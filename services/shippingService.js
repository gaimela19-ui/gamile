import ShippingZone from '../models/ShippingZone.js';
import ShippingRate from '../models/ShippingRate.js';
import Settings from '../models/Settings.js';

/**
 * Calculate shipping fee based on order details
 * @param {Object} params - Shipping calculation parameters
 * @param {number} params.subtotal - Order subtotal
 * @param {number} params.weight - Total weight of items
 * @param {string} params.country - Destination country
 * @param {string} params.region - Destination region (optional)
 * @param {string} params.areaGroup - Area grouping label (optional, overrides region when provided)
 * @param {string} params.city - Destination city (optional for city-specific rates)
 * @returns {Promise<number>} Calculated shipping fee
 */
export const calculateShippingFee = async ({ subtotal, weight, country, region, city, areaGroup }) => {
  try {
    const resolvedAreaGroup = await resolveAreaGroupForCity(areaGroup, city);
    const effectiveRegion = resolvedAreaGroup || region;
    // Free shipping threshold and fixed fee override (from Settings)
    try {
      const s = await Settings.findOne().sort({ updatedAt: -1 });
      // Free shipping if subtotal meets threshold
      if (s?.shipping?.freeShippingEnabled) {
        const min = typeof s.shipping.freeShippingMinSubtotal === 'number' ? s.shipping.freeShippingMinSubtotal : 0;
        if (typeof subtotal === 'number' && subtotal >= Math.max(0, min)) {
          return 0;
        }
      }
      // Global fixed fee takes effect only if free shipping not applied
      if (s?.shipping?.fixedFeeEnabled) {
        const amt = typeof s.shipping.fixedFeeAmount === 'number' ? s.shipping.fixedFeeAmount : 0;
        return Math.max(0, amt);
      }
    } catch (e) {
      // Non-fatal; proceed with normal logic
    }
    // City-first lookup: treat `countries` array as list of cities if no real country logic is used
    let zones = [];
    const trimmedCity = (city || '').trim();
    if (trimmedCity) {
      const cityRegex = buildCaseInsensitiveRegex(trimmedCity);
      zones = await ShippingZone.find({
        countries: { $elemMatch: { $regex: cityRegex } },
        isActive: true
      });
    }
    // If none by city, fall back to country / region (for future extensibility)
    if (zones.length === 0 && country) {
      zones = await ShippingZone.findByCountry(country);
    }
    if (zones.length === 0 && effectiveRegion) {
      zones = await ShippingZone.findByRegion(effectiveRegion);
    }
    if (zones.length === 0 && resolvedAreaGroup) {
      const areaRegex = buildCaseInsensitiveRegex(resolvedAreaGroup);
      zones = await ShippingZone.find({
        isActive: true,
        'areaGroupPrices.areaGroup': { $regex: areaRegex }
      });
    }
    if (zones.length === 0) {
      throw new Error('No shipping zones found for the specified location');
    }
    const normalizedAreaGroup = resolvedAreaGroup;
    if (normalizedAreaGroup) {
      const prioritized = zones
        .map(zone => ({ zone, entry: getAreaGroupEntry(zone, normalizedAreaGroup) }))
        .filter(item => item.entry && typeof item.entry.price === 'number' && item.entry.price >= 0);
      if (prioritized.length) {
        const cheapest = prioritized.reduce((min, item) => Math.min(min, item.entry.price), Infinity);
        if (Number.isFinite(cheapest)) {
          return cheapest;
        }
      }
    }
    
    const zoneIds = zones.map(z => z._id);
    // Get all shipping rates for the matching zones
    const allRates = [];
    for (const zone of zones) {
      const rates = await ShippingRate.findByZone(zone._id);
      allRates.push(...rates);
    }

    // If city provided, attempt to find city-specific overrides
    let citySpecific = [];
    if (city) {
      if (typeof ShippingRate.findByCity === 'function') {
        citySpecific = await ShippingRate.findByCity(city, zoneIds);
      } else if (zoneIds.length) {
        // Fallback manual query replicating findByCity logic
        const regex = new RegExp(`^${city}$`, 'i');
        citySpecific = await ShippingRate.find({
          zone: { $in: zoneIds },
          isActive: true,
          cities: { $elemMatch: { name: regex } }
        }).populate('zone');
      } else {
        const regex = new RegExp(`^${city}$`, 'i');
        citySpecific = await ShippingRate.find({
          isActive: true,
          cities: { $elemMatch: { name: regex } }
        }).populate('zone');
      }
    }
    
    if (allRates.length === 0) {
      throw new Error('No shipping rates found for the specified location');
    }
    
    // Calculate costs for all applicable rates
    const applicableRates = [];
    
    const candidateRates = citySpecific.length ? citySpecific : allRates;
    for (const rate of candidateRates) {
      const cost = rate.calculateCost(subtotal, weight);
      if (cost !== null) {
        applicableRates.push({
          rate,
          cost: resolveCityCost(rate, cost, city),
          method: rate.method,
          name: rate.name
        });
      }
    }
    
    const fallbackOptions = [];
    for (const zone of zones) {
      const areaEntry = getAreaGroupEntry(zone, resolvedAreaGroup);
      if (areaEntry && typeof areaEntry.price === 'number' && areaEntry.price >= 0) {
        fallbackOptions.push({
          rate: null,
          cost: areaEntry.price,
          method: 'area_group',
          name: `${zone.name} (${resolvedAreaGroup || 'Area'})`
        });
        continue;
      }
      if (typeof zone.zonePrice === 'number' && zone.zonePrice >= 0) {
        fallbackOptions.push({
          rate: null,
          cost: zone.zonePrice,
          method: 'zone_price',
          name: `${zone.name} Standard`
        });
      }
    }

    const combinedOptions = [...applicableRates, ...fallbackOptions];
    if (combinedOptions.length === 0) {
      throw new Error('No applicable shipping rates found for the order criteria');
    }
    
    // Sort by cost (cheapest first) and return the lowest cost
    combinedOptions.sort((a, b) => a.cost - b.cost);
    
    return combinedOptions[0].cost;
  } catch (error) {
    console.error('Error calculating shipping fee:', error);
    throw new Error(`Failed to calculate shipping fee: ${error.message}`);
  }
};

/**
 * Get available shipping options for a location
 * @param {Object} params - Location parameters
 * @param {string} params.country - Destination country
 * @param {string} params.region - Destination region (optional)
 * @param {number} params.subtotal - Order subtotal (optional)
 * @param {number} params.weight - Total weight (optional)
 * @returns {Promise<Array>} Available shipping options
 */
export const getAvailableShippingOptions = async ({ country, region, areaGroup, city, subtotal = 0, weight = 0 }) => {
  try {
    const resolvedAreaGroup = await resolveAreaGroupForCity(areaGroup, city);
    const effectiveRegion = resolvedAreaGroup || region;
    // Free shipping threshold and fixed fee override
    try {
      const s = await Settings.findOne().sort({ updatedAt: -1 });
      // Free shipping if subtotal meets threshold
      if (s?.shipping?.freeShippingEnabled) {
        const min = typeof s.shipping.freeShippingMinSubtotal === 'number' ? s.shipping.freeShippingMinSubtotal : 0;
        if (typeof subtotal === 'number' && subtotal >= Math.max(0, min)) {
          return [{
            id: 'free:threshold',
            name: 'Free Shipping',
            description: `Free shipping on orders over ${min}`,
            method: 'free',
            cost: 0,
            zone: 'All',
            estimatedDays: null
          }];
        }
      }
      if (s?.shipping?.fixedFeeEnabled) {
        const amt = typeof s.shipping.fixedFeeAmount === 'number' ? s.shipping.fixedFeeAmount : 0;
        return [{
          id: 'fixed:store',
          name: 'Standard Shipping',
          description: 'Fixed fee set by store',
          method: 'fixed_fee',
          cost: Math.max(0, amt),
          zone: 'All',
          estimatedDays: null
        }];
      }
    } catch (e) {
      // ignore and continue with zone/rates logic
    }
    // City-first strategy (we repurpose `countries` to store city names)
    let zones = [];
    const trimmedCity = (city || '').trim();
    if (trimmedCity) {
      const cityRegex = buildCaseInsensitiveRegex(trimmedCity);
      zones = await ShippingZone.find({
        countries: { $elemMatch: { $regex: cityRegex } },
        isActive: true
      });
    }
    if (zones.length === 0 && country) {
      zones = await ShippingZone.findByCountry(country);
    }
    if (zones.length === 0 && effectiveRegion) {
      zones = await ShippingZone.findByRegion(effectiveRegion);
    }
    if (zones.length === 0 && resolvedAreaGroup) {
      const areaRegex = buildCaseInsensitiveRegex(resolvedAreaGroup);
      zones = await ShippingZone.find({
        isActive: true,
        'areaGroupPrices.areaGroup': { $regex: areaRegex }
      });
    }
    if (zones.length === 0) {
      return [];
    }

    const normalizedAreaGroup = resolvedAreaGroup;
    const areaGroupEntriesByZone = new Map();
    if (normalizedAreaGroup) {
      zones.forEach(zone => {
        const entry = getAreaGroupEntry(zone, normalizedAreaGroup);
        if (entry && typeof entry.price === 'number' && entry.price >= 0) {
          areaGroupEntriesByZone.set(String(zone._id), entry);
        }
      });
    }
    
    const zoneIds = zones.map(z => z._id);
    // Get all shipping rates for the matching zones
    const allRates = [];
    for (const zone of zones) {
      const rates = await ShippingRate.findByZone(zone._id);
      allRates.push(...rates);
    }

    // City-specific overrides
    let citySpecific = [];
    if (city) {
      if (typeof ShippingRate.findByCity === 'function') {
        citySpecific = await ShippingRate.findByCity(city, zoneIds);
      } else if (zoneIds.length) {
        const regex = new RegExp(`^${city}$`, 'i');
        citySpecific = await ShippingRate.find({
          zone: { $in: zoneIds },
          isActive: true,
          cities: { $elemMatch: { name: regex } }
        }).populate('zone');
      } else {
        const regex = new RegExp(`^${city}$`, 'i');
        citySpecific = await ShippingRate.find({
          isActive: true,
          cities: { $elemMatch: { name: regex } }
        }).populate('zone');
      }
    }
    
    // Calculate costs for all applicable rates
    const options = [];
    
    const candidateRates = citySpecific.length ? citySpecific : allRates;
    for (const rate of candidateRates) {
      const zoneId = String(rate.zone?._id || rate.zone || '');
      if (normalizedAreaGroup && areaGroupEntriesByZone.has(zoneId)) {
        continue;
      }
      const cost = rate.calculateCost(subtotal, weight);
      if (cost !== null) {
        options.push({
          id: rate._id,
          name: rate.name,
          description: rate.description,
          method: rate.method,
          cost: resolveCityCost(rate, cost, city),
          zone: rate.zone.name,
          estimatedDays: rate.estimatedDays || null
        });
      }
    }

    // Fallback: prefer area-group specific price, otherwise uniform zone price
    for (const zone of zones) {
      const zoneId = String(zone._id);
      const areaEntry = normalizedAreaGroup ? areaGroupEntriesByZone.get(zoneId) || null : null;
      if (areaEntry && typeof areaEntry.price === 'number' && areaEntry.price >= 0) {
        const areaCost = areaEntry.price;
        const estimatedDays = getAreaGroupEstimatedDays(areaEntry);
        const etaLabel = getAreaGroupEtaLabel(areaEntry);
        const hasEquivalent = options.some(o => o.zone === zone.name && o.method === 'area_group' && o.cost <= areaCost);
        if (!hasEquivalent) {
          options.push({
            id: `areaGroup:${zone._id}:${normalizedAreaGroup.toLowerCase()}`,
            name: `${zone.name} ${normalizedAreaGroup || 'Area'}`,
            description: etaLabel ? `Area group shipping · ETA ${etaLabel}` : 'Area group shipping',
            method: 'area_group',
            cost: areaCost,
            zone: zone.name,
            estimatedDays: estimatedDays ?? null
          });
        }
        continue;
      }
      if (typeof zone.zonePrice === 'number' && zone.zonePrice >= 0) {
        const hasEquivalent = options.some(o => o.zone === zone.name && o.cost <= zone.zonePrice);
        if (!hasEquivalent) {
          options.push({
            id: `zonePrice:${zone._id}`,
            name: `${zone.name} Standard`,
            description: 'Zone base shipping',
            method: 'zone_price',
            cost: zone.zonePrice,
            zone: zone.name,
            estimatedDays: null
          });
        }
      }
    }
    
    // Sort by cost (cheapest first)
    options.sort((a, b) => a.cost - b.cost);
    
    return options;
  } catch (error) {
    console.error('Error getting shipping options:', error);
    throw new Error(`Failed to get shipping options: ${error.message}`);
  }
};

// Helper to override cost if city entry exists with specific cost
function resolveCityCost(rate, baseCost, city) {
  if (!city || !rate.cities || !rate.cities.length) return baseCost;
  const match = rate.cities.find(c => c.name && city && c.name.toLowerCase() === city.toLowerCase());
  if (match && typeof match.cost === 'number') {
    return match.cost;
  }
  return baseCost;
}

const NORMALIZE_REGEX = /[\u064B-\u0652\u0640]/g;
const normalizeLabel = (value = '') =>
  value
    .toString()
    .toLowerCase()
    .trim()
    .replace(NORMALIZE_REGEX, '');

function getAreaGroupEntry(zone, areaGroup) {
  if (!areaGroup || !zone?.areaGroupPrices?.length) return null;
  const target = normalizeLabel(areaGroup);
  return zone.areaGroupPrices.find(entry =>
    entry?.areaGroup && normalizeLabel(entry.areaGroup) === target
  ) || null;
}

function resolveAreaGroupCost(zone, areaGroup) {
  const entry = getAreaGroupEntry(zone, areaGroup);
  if (entry && typeof entry.price === 'number' && entry.price >= 0) {
    return entry.price;
  }
  return null;
}

function getAreaGroupEta(entry) {
  if (!entry || entry.deliveryTimeValue === undefined || entry.deliveryTimeValue === null) return null;
  const label = entry.deliveryTimeValue.toString().trim();
  if (!label) return null;
  const match = label.match(/(\d+(?:\.\d+)?)/);
  const numeric = match ? Number(match[1]) : null;
  const unit = entry.deliveryTimeUnit === 'hours' ? 'hours' : 'days';
  return { label, numeric, unit };
}

function getAreaGroupEstimatedDays(entry) {
  const eta = getAreaGroupEta(entry);
  if (!eta || !Number.isFinite(eta.numeric) || eta.numeric <= 0) return null;
  return eta.unit === 'hours' ? eta.numeric / 24 : eta.numeric;
}

function getAreaGroupEtaLabel(entry) {
  const eta = getAreaGroupEta(entry);
  if (!eta) return null;
  if (/(day|hour)s?/i.test(eta.label)) {
    return eta.label;
  }
  return `${eta.label} ${eta.unit}`;
}

// Cache city → areaGroup mappings to avoid repeated full Settings scans
const cityAreaGroupCache = {
  map: null,
  expires: 0
};

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const buildCaseInsensitiveRegex = (value = '') => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return new RegExp(`^${escapeRegex(trimmed)}$`, 'i');
};

const extractCityRows = (checkoutForm = {}) => {
  if (Array.isArray(checkoutForm.cityTable) && checkoutForm.cityTable.length) {
    return checkoutForm.cityTable;
  }
  if (Array.isArray(checkoutForm.cityRows) && checkoutForm.cityRows.length) {
    return checkoutForm.cityRows;
  }
  return [];
};

const buildCityAreaGroupMap = (checkoutForm = {}) => {
  const rows = extractCityRows(checkoutForm);
  const map = new Map();
  rows.forEach(entry => {
    if (!entry || typeof entry !== 'object') return;
    const areaGroup = (entry.areaGroup || entry.area_group || entry.group || entry.region || '').toString().trim();
    if (!areaGroup) return;
    const label = (entry.ar || entry.en || entry.he || entry.label || entry.name || entry.city || entry.value || '').toString().trim();
    if (!label) return;
    const key = normalizeLabel(label);
    if (key && !map.has(key)) {
      map.set(key, areaGroup);
    }
  });
  return map;
};

const getCityAreaGroupMap = async () => {
  const now = Date.now();
  if (cityAreaGroupCache.map && now < cityAreaGroupCache.expires) {
    return cityAreaGroupCache.map;
  }
  try {
    const settings = await Settings.findOne();
    const checkoutForm = settings?.checkoutForm || {};
    const map = buildCityAreaGroupMap(checkoutForm);
    cityAreaGroupCache.map = map;
    cityAreaGroupCache.expires = now + 10 * 60 * 1000; // 10 minutes
    return map;
  } catch (error) {
    console.warn('ShippingService: unable to load checkout city table for area groups', error);
    if (!cityAreaGroupCache.map) {
      cityAreaGroupCache.map = new Map();
    }
    return cityAreaGroupCache.map;
  }
};

const resolveAreaGroupForCity = async (areaGroup, city) => {
  const trimmed = (areaGroup || '').trim();
  if (trimmed) return trimmed;
  if (!city) return '';
  try {
    const map = await getCityAreaGroupMap();
    const key = normalizeLabel(city);
    return map.get(key) || '';
  } catch (error) {
    console.warn('ShippingService: failed to resolve area group for city', error);
    return '';
  }
};

/**
 * Validate shipping address
 * @param {Object} address - Shipping address
 * @param {string} address.country - Country
 * @param {string} address.region - State/Province/Region
 * @param {string} address.city - City
 * @param {string} address.postalCode - Postal/ZIP code
 * @returns {Promise<boolean>} Whether address is valid for shipping
 */
export const validateShippingAddress = async (address) => {
  try {
    const { country, region } = address;
    
    if (!country) {
      return false;
    }
    
    // Check if we have shipping zones for this location
    let zones = await ShippingZone.findByCountry(country);
    
    if (zones.length === 0 && region) {
      zones = await ShippingZone.findByRegion(region);
    }
    
    return zones.length > 0;
  } catch (error) {
    console.error('Error validating shipping address:', error);
    return false;
  }
};

/**
 * Create default shipping zones and rates
 * This function can be used for initial setup
 */
export const createDefaultShippingData = async () => {
  try {
    // Check if zones already exist
    const existingZones = await ShippingZone.find();
    if (existingZones.length > 0) {
      console.log('Shipping zones already exist, skipping default creation');
      return;
    }
    
    // Create default zones
    const domesticZone = new ShippingZone({
      name: 'Domestic',
      description: 'Local shipping within the country',
      countries: ['US'], // Adjust based on your primary country
      isActive: true,
      order: 1
    });
    
    const internationalZone = new ShippingZone({
      name: 'International',
      description: 'International shipping',
      countries: ['CA', 'MX', 'GB', 'FR', 'DE', 'AU', 'JP'], // Add more as needed
      isActive: true,
      order: 2
    });
    
    await domesticZone.save();
    await internationalZone.save();
    
    // Create default rates
    const domesticStandard = new ShippingRate({
      zone: domesticZone._id,
      name: 'Standard Shipping',
      description: 'Standard domestic shipping (5-7 business days)',
      method: 'flat_rate',
      cost: 9.99,
      conditions: {
        minOrderValue: 0
      },
      isActive: true,
      order: 1
    });
    
    const domesticExpress = new ShippingRate({
      zone: domesticZone._id,
      name: 'Express Shipping',
      description: 'Express domestic shipping (2-3 business days)',
      method: 'flat_rate',
      cost: 19.99,
      conditions: {
        minOrderValue: 0
      },
      isActive: true,
      order: 2
    });
    
    const domesticFree = new ShippingRate({
      zone: domesticZone._id,
      name: 'Free Shipping',
      description: 'Free shipping on orders over $50',
      method: 'free',
      cost: 0,
      conditions: {
        minOrderValue: 50
      },
      isActive: true,
      order: 0
    });
    
    const internationalStandard = new ShippingRate({
      zone: internationalZone._id,
      name: 'International Standard',
      description: 'Standard international shipping (10-15 business days)',
      method: 'flat_rate',
      cost: 24.99,
      conditions: {
        minOrderValue: 0
      },
      isActive: true,
      order: 1
    });
    
    await domesticStandard.save();
    await domesticExpress.save();
    await domesticFree.save();
    await internationalStandard.save();
    
    console.log('Default shipping zones and rates created successfully');
  } catch (error) {
    console.error('Error creating default shipping data:', error);
    throw error;
  }
};
