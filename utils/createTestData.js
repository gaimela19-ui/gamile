import DeliveryCompany from '../models/DeliveryCompany.js';

export async function createTestDeliveryCompany() {
  try {
    // Check if a test company already exists
    const existing = await DeliveryCompany.findOne({ name: 'Test Courier' });
    if (existing) return existing;

    const company = await DeliveryCompany.create({
      name: 'Test Courier',
      code: 'TEST',
  isActive: true,
  isDefault: true,
      apiConfiguration: {
  baseUrl: '',
  authMethod: 'none',
  isTestMode: true,
      },
      fieldMappings: [
        { sourceField: 'orderNumber', targetField: 'orderNumber', required: true },
        { sourceField: 'customerInfo.firstName', targetField: 'firstName', required: true },
        { sourceField: 'customerInfo.lastName', targetField: 'lastName', required: true },
        { sourceField: 'customerInfo.mobile', targetField: 'phone', required: true },
        { sourceField: 'shippingAddress.street', targetField: 'street', required: true },
        { sourceField: 'shippingAddress.city', targetField: 'city', required: true },
        { sourceField: 'shippingAddress.country', targetField: 'country', required: true }
      ],
      statusMapping: [
        { companyStatus: 'created', internalStatus: 'assigned' },
        { companyStatus: 'in_transit', internalStatus: 'in_transit' },
        { companyStatus: 'delivered', internalStatus: 'delivered' }
      ]
    });

    return company;
  } catch (err) {
    console.error('Failed to create test delivery company:', err.message);
    throw err;
  }
}
