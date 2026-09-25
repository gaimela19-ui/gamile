import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    default: 'Eva Curves Fashion Store'
  },
  email: {
    type: String,
    required: true,
    default: 'contact@evacurves.com'
  },
  phone: {
    type: String,
    default: '+1 (555) 123-4567'
  },
  address: {
    type: String,
    default: '123 Fashion Street, NY 10001'
  },
  availableTime: {
    type: String,
    default: ''
  },
  // Optional public URL or map link for the store location (e.g. Google Maps / Waze / custom contact page)
  // Example: https://www.google.com/maps/search/?api=1&query=Your+Store+Address
  // Keep as simple string (not required) to avoid over‑validating; frontend can ensure proper URL format.
  addressLink: {
    type: String,
    default: ''
  },
  // Optional explicit URL used when the user taps the Open Map button.
  // If provided, this is used instead of the generic map search URL.
  addressOpenLink: {
    type: String,
    default: ''
  },
  currency: {
    type: String,
    required: true,
    enum: ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'JOD', 'LBP', 'EGP', 'IQD', 'ILS'],
    default: 'USD'
  },
  timezone: {
    type: String,
    required: true,
    default: 'UTC-5'
  },
  logo: {
    type: String,
    default: null
  },
  // Favicon (SVG/PNG/ICO). Managed via admin panel; when set, overrides default /favicon.svg served from public root.
  favicon: {
    type: String,
    default: null
  },
  // Background image for authentication pages (login/register)
  authBackgroundImage: {
    type: String,
    default: ''
  },
  // Logo sizing (persisted so guests see admin changes)
  logoWidthMobile: {
    type: Number,
    default: 56 // px
  },
  logoMaxHeightMobile: {
    type: Number,
    default: 40 // px
  },
  logoWidthDesktop: {
    type: Number,
    default: 100 // px
  },
  // Backend API base URL (e.g., https://api.example.com). Defaults to local dev server.
  apiBaseUrl: {
    type: String,
    default: 'http://localhost:5000'
  },
  
  // Design/Theme settings
  primaryColor: {
    type: String,
    default: '#3b82f6' // Blue
  },
  secondaryColor: {
    type: String,
    default: '#64748b' // Slate
  },
  accentColor: {
    type: String,
    default: '#f59e0b' // Amber
  },
  // Search box border color (optional) – allows theming search input outline
  searchBorderColor: {
    type: String,
    default: ''
  },
  textColor: {
    type: String,
    default: '#1f2937' // Gray 800
  },
  backgroundColor: {
    type: String,
    default: '#ffffff' // White
  },
  customCss: {
    type: String,
    default: ''
  },
  // Footer-specific text color (overrides default text color within footer)
  footerTextColor: {
    type: String,
    default: ''
  },
  // New Arrivals page (mobile-specific theming)
  newArrivalsMobileHeadingColor: { type: String, default: '' }, // e.g. '#ffffff'
  newArrivalsMobileTextColor: { type: String, default: '' }, // e.g. '#e5e7eb'
  newArrivalsMobileOverlayBg: { type: String, default: '' }, // e.g. 'rgba(0,0,0,0.4)' or hex with opacity via CSS
  newArrivalsMobileProductNameColor: { type: String, default: '' }, // product name color on mobile New Arrivals grid
  newArrivalsMobileProductPriceColor: { type: String, default: '' }, // product price color on mobile New Arrivals grid
  // New Arrivals dedicated banner (optional)
  newArrivalsBannerEnabled: { type: Boolean, default: false }, // toggles banner visibility
  newArrivalsBannerImage: { type: String, default: '' }, // image URL/path (uploaded via admin)
  newArrivalsBannerHeading: { type: String, default: '' }, // overrides default page heading when provided & enabled
  newArrivalsBannerSubheading: { type: String, default: '' }, // optional supporting text under heading
  // Navigation styles (top bar + mega menu)
  navCategoryFontColor: { type: String, default: '' },
  navCategoryFontSize: { type: String, enum: ['small','medium','large'], default: 'medium' },
  navPanelFontColor: { type: String, default: '' },
  navPanelColumnActiveBgColor: { type: String, default: '' },
  navPanelAccentColor: { type: String, default: '' },
  navPanelHeaderColor: { type: String, default: '' },
  fontFamily: {
    type: String,
    default: 'Inter, system-ui, sans-serif'
  },
  headingFont: {
    type: String,
    default: 'Inter, system-ui, sans-serif'
  },
  bodyFont: {
    type: String,
    default: 'Inter, system-ui, sans-serif'
  },
  borderRadius: {
    type: String,
    default: '8px'
  },
  buttonStyle: {
    type: String,
    enum: ['rounded', 'square', 'pill'],
    default: 'rounded'
  },
  
  // Layout settings
  headerLayout: {
    type: String,
    enum: ['classic', 'modern', 'minimal'],
    default: 'modern'
  },
  headerBackgroundColor: {
    type: String,
    default: ''
  },
  // Optional header background image (URL, data URI, or /uploads relative path)
  headerBackgroundImage: {
    type: String,
    default: ''
  },
  // Optional background image for the announcements (sliding text) bar
  announcementsBackgroundImage: {
    type: String,
    default: ''
  },
  // Optional background image for the navigation links bar (below header)
  navBackgroundImage: {
    type: String,
    default: ''
  },
  // Global store background (applies to the entire site body)
  storeBackgroundImage: {
    type: String,
    default: ''
  },
  // Optional global store background color (fallback/overlay)
  storeBackgroundColor: {
    type: String,
    default: ''
  },
  // Dedicated product details background overrides (color/image)
  productDetailBackgroundColor: {
    type: String,
    default: ''
  },
  productDetailBackgroundImage: {
    type: String,
    default: ''
  },
  productCardBackgroundColor: {
    type: String,
    default: ''
  },
  productCardBackgroundImage: {
    type: String,
    default: ''
  },
  productImageBackgroundColor: {
    type: String,
    default: ''
  },
  productImageBackgroundImage: {
    type: String,
    default: ''
  },
  categoryBackgroundColor: {
    type: String,
    default: ''
  },
  categoryBackgroundImage: {
    type: String,
    default: ''
  },
  headerTextColor: {
    type: String,
    default: ''
  },
  headerIcons: {
    showLanguage: { type: Boolean, default: true },
    showCurrency: { type: Boolean, default: true },
    showSearch: { type: Boolean, default: true },
    showWishlist: { type: Boolean, default: true },
    showCart: { type: Boolean, default: true },
    showAccount: { type: Boolean, default: true }
  },
  // Header icon style variants
  headerIconVariants: {
    cart: { type: String, enum: ['shoppingBag', 'shoppingCart'], default: 'shoppingBag' },
    wishlist: { type: String, enum: ['heart', 'bookmark'], default: 'heart' }
  },
  // Custom header icon URLs
  headerIconAssets: {
    cart: { type: String, default: '' },
    wishlist: { type: String, default: '' },
    account: { type: String, default: '' },
    search: { type: String, default: '' },
    language: { type: String, default: '' },
    currency: { type: String, default: '' }
  },
  // Header icon backgrounds (color and/or image)
  headerIconBackgrounds: {
    cart: {
      color: { type: String, default: '' },
      image: { type: String, default: '' }
    },
    wishlist: {
      color: { type: String, default: '' },
      image: { type: String, default: '' }
    },
    account: {
      color: { type: String, default: '' },
      image: { type: String, default: '' }
    },
    search: {
      color: { type: String, default: '' },
      image: { type: String, default: '' }
    },
    language: {
      color: { type: String, default: '' },
      image: { type: String, default: '' }
    },
    currency: {
      color: { type: String, default: '' },
      image: { type: String, default: '' }
    }
  },
  footerStyle: {
    type: String,
    enum: ['simple', 'detailed', 'newsletter'],
    default: 'detailed'
  },
  productCardStyle: {
    type: String,
    enum: ['modern', 'classic', 'minimal'],
    default: 'modern'
  },
  // Product grid layout variants
  productGridStyle: {
    type: String,
    enum: ['standard', 'compact', 'masonry', 'list', 'wide', 'gallery', 'carousel'],
    default: 'standard'
  },
  
  // Translations/AI settings (DeepSeek)
  translations: {
    deepseek: {
      enabled: { type: Boolean, default: false },
      apiKey: { type: String, default: '' }, // stored securely in DB; masked in API responses
      apiUrl: { type: String, default: '' }, // optional override (falls back to env or default)
      model: { type: String, default: '' }   // optional override (falls back to env default)
    }
  },
  // Product listing filter visibility toggles
  showColorFilter: { type: Boolean, default: true }, // allow hiding color facet from storefront
  
  // Social media links
  socialLinks: {
    facebook: { type: String, default: '' },
    twitter: { type: String, default: '' },
    instagram: { type: String, default: '' },
    youtube: { type: String, default: '' },
    whatsapp: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    tiktok: { type: String, default: '' }
  },
  
  // SEO settings
  siteTitle: {
    type: String,
    default: 'Eva Curves Fashion Store'
  },
  siteDescription: {
    type: String,
    default: 'Premium fashion store offering the latest trends in clothing and accessories'
  },
  keywords: [{
    type: String
  }],
  
  // Analytics
  facebookPixel: {
    pixelId: { type: String, default: '' },
    enabled: { type: Boolean, default: false }
  },
  googleAnalytics: {
    trackingId: { type: String, default: '' },
    enabled: { type: Boolean, default: false }
  },
  googleTagManager: {
    containerId: { type: String, default: '' },
    enabled: { type: Boolean, default: false }
  },
  googleAds: {
    conversionId: { type: String, default: '' },
    conversionLabel: { type: String, default: '' },
    enabled: { type: Boolean, default: false }
  },
  googleMerchantCenter: {
    merchantId: { type: String, default: '' },
    enabled: { type: Boolean, default: false }
  },
  visitorPopup: {
    id: { type: String, default: 'default' },
    name: { type: String, default: 'Default Campaign' },
    enabled: { type: Boolean, default: false },
    fullScreenMode: { type: Boolean, default: false },
    platform: { type: String, enum: ['web', 'mobile', 'both'], default: 'both' },
    activeRecordId: { type: String, default: 'default' },
    activeRecordName: { type: String, default: 'Default Campaign' },
    records: [{
      id: { type: String, required: true },
      name: { type: String, default: 'Campaign' },
      enabled: { type: Boolean, default: false },
      fullScreenMode: { type: Boolean, default: false },
      platform: { type: String, enum: ['web', 'mobile', 'both'], default: 'both' },
      showOnScroll: { type: Boolean, default: true },
      showExitIntent: { type: Boolean, default: true },
      scrollThreshold: { type: Number, default: 360, min: 0, max: 4000 },
      frequencyDays: { type: Number, default: 7, min: 1, max: 30 },
      heading: { type: String, default: 'Register & get 10% OFF' },
      bodyAr: { type: String },
      bodyHe: { type: String },
      bodyEn: { type: String },
      ctaLabel: { type: String, default: 'Register now' },
      ctaHref: { type: String, default: '/register' },
      couponCode: { type: String, default: '' },
      couponNote: { type: String, default: '* Coupon applied automatically after you finish registering.' },
      pixelEventBase: { type: String, default: 'VisitorPopup' },
      accentColor: { type: String },
      textColor: { type: String },
      backgroundColor: { type: String },
      backgroundImage: { type: String, default: '' },
      headingColor: { type: String },
      bodyColor: { type: String },
      headingFontSize: { type: Number, default: 32 },
      bodyFontSize: { type: Number, default: 16 },
      ctaFontSize: { type: Number, default: 18 },
      metaFontSize: { type: Number, default: 12 }
    }],
    showOnScroll: { type: Boolean, default: true },
    showExitIntent: { type: Boolean, default: true },
    scrollThreshold: { type: Number, default: 360, min: 0, max: 4000 },
    frequencyDays: { type: Number, default: 7, min: 1, max: 30 },
    heading: { type: String, default: 'Register & get 10% OFF' },
    bodyAr: { type: String },
    bodyHe: { type: String },
    bodyEn: { type: String },
    ctaLabel: { type: String, default: 'Register now' },
    ctaHref: { type: String, default: '/register' },
    couponCode: { type: String, default: '' },
    couponNote: { type: String, default: '* Coupon applied automatically after you finish registering.' },
    pixelEventBase: { type: String, default: 'VisitorPopup' },
    accentColor: { type: String },
    textColor: { type: String },
    backgroundColor: { type: String },
    backgroundImage: { type: String, default: '' },
    headingColor: { type: String },
    bodyColor: { type: String },
    headingFontSize: { type: Number, default: 32 },
    bodyFontSize: { type: Number, default: 16 },
    ctaFontSize: { type: Number, default: 18 },
    metaFontSize: { type: Number, default: 12 }
  },
  // Scroll-to-top button theme
  scrollTopBgColor: { type: String, default: '' },
  scrollTopTextColor: { type: String, default: '' },
  scrollTopHoverBgColor: { type: String, default: '' },
  scrollTopPingColor: { type: String, default: '' },
  // Add To Cart button theme (persist so guests see admin design)
  atcBgColor: { type: String, default: '' },
  atcTextColor: { type: String, default: '' },
  atcHoverBgColor: { type: String, default: '' },
  // Hero carousel settings
  heroAutoplayMs: {
    type: Number,
    default: 5000, // 5 seconds
    min: 0
  },
  // Google auth configuration (admin managed, non-secret)
  googleAuth: {
    enabled: { type: Boolean, default: false },
    clientId: { type: String, default: '' },
    // Write-only client secret (never returned in GET). If migrating to OAuth code flow.
    clientSecret: { type: String, default: '' }
  },
  // Facebook auth configuration (admin managed)
  facebookAuth: {
    enabled: { type: Boolean, default: false },
    appId: { type: String, default: '' },
    // Write-only App Secret (never returned in GET)
    appSecret: { type: String, default: '' },
    // Graph API version, optional (e.g., 'v19.0'). If empty, SDK default is used
    graphVersion: { type: String, default: '' }
  },
  // Apple Sign In configuration (admin managed, non-secret)
  appleAuth: {
    enabled: { type: Boolean, default: false },
    // Service ID (web) or Bundle ID (native) expected in Apple identity token audience
    clientId: { type: String, default: '' }
  }
}, {
  timestamps: true
});

// Accessibility feature toggles
settingsSchema.add({
  a11y: {
    // Controls visibility of the floating "Read page" button in the storefront
    showReadPageButton: { type: Boolean, default: true }
  }
});

// Cloudinary credentials (server-side use only). Do NOT expose secrets via public GET.
settingsSchema.add({
  cloudinary: {
    cloudName: { type: String, default: '' },
    apiKey: { type: String, default: '' },
    apiSecret: { type: String, default: '' }
  }
});

// Inventory management configuration
settingsSchema.add({
  inventory: {
    autoDecrementOnOrder: { type: Boolean, default: true },
    autoIncrementOnCancel: { type: Boolean, default: true },
    autoIncrementOnReturn: { type: Boolean, default: true },
    allowNegativeStock: { type: Boolean, default: true },
    reserveOnCheckout: { type: Boolean, default: true },
    reservationTTLMinutes: { type: Number, default: 15, min: 1, max: 1440 },
    lowStockThreshold: { type: Number, default: 5, min: 1, max: 100000 }
  }
});

// Grooming / Booking availability configuration (admin-managed)
settingsSchema.add({
  grooming: {
    // When true, only `enabledDates` are treated as bookable (whitelist).
    useDateWhitelist: { type: Boolean, default: false },
    // Explicit list of dates (YYYY-MM-DD) that are allowed when `useDateWhitelist` is true
    enabledDates: { type: [String], default: [] },
    // Explicit list of dates (YYYY-MM-DD) that are blocked when `useDateWhitelist` is false
    disabledDates: { type: [String], default: [] },
    // How many days ahead to expose by default when generating availability (fallback)
    bookingWindowDays: { type: Number, default: 30 },
    // Optional custom slot list (HH:mm). When empty, fallback slots are used server-side
    slots: {
      type: [String],
      default: ['07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00']
    },
    // Optional per-day overrides: map of YYYY-MM-DD -> custom slot list
    dateSlotOverrides: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    },
    // Optional override for per-slot capacity; defaults to env BOOKING_SLOT_CAPACITY when empty
    slotCapacity: { type: Number, default: 4, min: 1, max: 50 },
    // Booking hero banner controls (public booking page)
    showHeroBanner: { type: Boolean, default: true },
    heroBannerImage: { type: String, default: '' }
  }
});

// Rivhit ERP integration configuration
settingsSchema.add({
  rivhit: {
    enabled: { type: Boolean, default: false },
    apiUrl: { type: String, default: 'https://api.rivhit.co.il/online/RivhitOnlineAPI.svc' },
    tokenApi: { type: String, default: '' }, // write-only style; mask in API responses
    defaultStorageId: { type: Number, default: 0 }, // 0 or empty -> all storages
    // Transport to Rivhit: 'json' (WCF JSON endpoints) or 'soap' (SOAP/XML). Default 'json'.
    transport: { type: String, enum: ['json', 'soap'], default: 'json' }
  }
});

// MCG Gateway integration configuration (OAuth2 client credentials)
settingsSchema.add({
  mcg: {
    enabled: { type: Boolean, default: false },
    baseUrl: { type: String, default: 'https://api.mcgateway.com' },
    clientId: { type: String, default: '' },
    clientSecret: { type: String, default: '' }, // write-only; mask in API responses
    scope: { type: String, default: '' },
    apiVersion: { type: String, default: 'v2.6' },
    // API flavor: '' (legacy) or 'uplicali' for SuperMCG/MCG_API spec
    apiFlavor: { type: String, default: '' },
    // Optional override for OAuth token endpoint (e.g., Azure AD v2.0 token URL)
    tokenUrl: { type: String, default: '' },
    // Optional extra API key header for gateway/APIM (name/value)
    extraHeaderName: { type: String, default: '' },
    extraHeaderValue: { type: String, default: '' }, // write-only; mask in API responses
    // Uplîcali identifiers used in query string and headers: code/key/client_id
    vendorCode: { type: String, default: '' },
    retailerKey: { type: String, default: '' },
    retailerClientId: { type: String, default: '' },
  // When true (Uplîcali), prefer item_id (mcgItemId) over barcode for push-back mapping when both exist
  preferItemId: { type: Boolean, default: false },
    // Optional group id for Uplîcali API (some retailers segment inventory by group)
    group: { type: Number },
    // Price tax multiplier to apply for MCG-imported prices when item_final_price is not provided
    taxMultiplier: { type: Number, default: 1.18, min: 1 },
    // When true, push stock decrements back to MCG as delta updates
    pushStockBackEnabled: { type: Boolean, default: false },
    // Automatic pull: periodically sync stock from MCG into local inventory
    autoPullEnabled: { type: Boolean, default: true },
    // How often to pull in minutes (min 1, default 1)
    pullEveryMinutes: { type: Number, default: 1, min: 1 },
    // Automatically create new Product documents for unseen MCG items during auto pull
    autoCreateItemsEnabled: { type: Boolean, default: true },
    // (Optional) placeholder image URL for auto-created items; when empty uses a generic placeholder service
    autoCreatePlaceholderImage: { type: String, default: '' },
    // When true (legacy flavor), auto-pull loops through all pages instead of only first page
    autoPullAllPages: { type: Boolean, default: false }
  }
});

// Mobile app bottom tab bar icon configuration (admin configurable)
// Each tab can have optional active/inactive icon URLs (absolute, /uploads, or data URI)
// Center button supports a single icon (when set, overrides gradient text)
settingsSchema.add({
  // Mobile Home header (top overlay/compact) icon visibility
  mobileHomeHeader: {
    showMessages: { type: Boolean, default: true },
    showCalendar: { type: Boolean, default: true }
  },

  mobileTabBar: {
    home: {
      active: { type: String, default: '' },
      inactive: { type: String, default: '' },
      label: { type: String, default: '' },
      ionActive: { type: String, default: '' },
      ionInactive: { type: String, default: '' },
      size: { type: Number, default: 24, min: 12, max: 48 }
    },
    category: {
      active: { type: String, default: '' },
      inactive: { type: String, default: '' },
      label: { type: String, default: '' },
      ionActive: { type: String, default: '' },
      ionInactive: { type: String, default: '' },
      size: { type: Number, default: 24, min: 12, max: 48 }
    },
    cart: {
      active: { type: String, default: '' },
      inactive: { type: String, default: '' },
      label: { type: String, default: '' },
      ionActive: { type: String, default: '' },
      ionInactive: { type: String, default: '' },
      size: { type: Number, default: 24, min: 12, max: 48 }
    },
    me: {
      active: { type: String, default: '' },
      inactive: { type: String, default: '' },
      label: { type: String, default: '' },
      ionActive: { type: String, default: '' },
      ionInactive: { type: String, default: '' },
      size: { type: Number, default: 24, min: 12, max: 48 }
    },
    center: {
      icon: { type: String, default: '' },
      label: { type: String, default: '' },
      iconSize: { type: Number, default: 28, min: 16, max: 56 }
    }
  }
});

// Checkout form customization (admin configurable)
settingsSchema.add({
  checkoutForm: {
    showEmail: { type: Boolean, default: false },
    showLastName: { type: Boolean, default: false },
    // Allow users to proceed to checkout without authentication
    allowGuestCheckout: { type: Boolean, default: true },
    // Future toggles (currently not rendered in UI):
    showSecondaryMobile: { type: Boolean, default: false },
    showCountry: { type: Boolean, default: false },
    // Structured multilingual city labels (editable from admin UI)
    cityTable: [{
      ar: { type: String, default: '' },
      en: { type: String, default: '' },
      he: { type: String, default: '' },
      areaGroup: { type: String, default: '' }
    }],
    // Cities list for dropdown
    cities: {
      type: [String],
      default: [
        'ابو قويدر',
        'الجولان',
        'الريحانية',
        'الظهرية',
        'ام الفحم',
        'بديا',
        'بيت شيمش',
        'جفعات شموئل',
        'جولس',
        'حزمه',
        'حسنيه',
        'خضيرة',
        'دير رافات',
        'راس علي',
        'رحوفوت',
        'رمانه',
        'رموت هشفيم',
        'صندله',
        'طيرة الكرمل',
        'عين الاسد',
        'عين حوض',
        'كريات اتا',
        'كسرى سميع',
        'لهافيم',
        'معليا',
        'معلي افريم',
        'نهاريا',
        'نوف هجليل',
        'هود هشارون',
        'يوكنعام',
        'ירושלים',
        'الضفة الغربية',
        'منطقة ابو غوش',
        'الداخل',
        'قرى الخليل',
        'قباطية',
        'اريحا',
        'العيزرية',
        'الزعيم',
        'يطا',
        'بيت لحم',
        'الخليل',
        'طوباس',
        'طولكرم',
        'سلفيت',
        'ابو غوش',
        'جنين',
        'قلقيلية',
        'ابو ديس',
        'عين رافا',
        'حيفا',
        'عناتا',
        'سخنين',
        'ضواحي بيت لحم',
        'مخيم شعفاط',
        'ضواحي القدس',
        'السواحرة الشرقية',
        'إم الفحم',
        'البيرة',
        'عين نقوبا',
        'كفر عقب',
        'غزة',
        'ضواحي رام الله',
        'الرام',
        'رام الله',
        'نابلس',
        'ابطن',
        'ابو اسنان',
        'ابو تلول',
        'ابو سنان',
        'ابو قرينات',
        'اريال',
        'اشدود',
        'اشكلون',
        'اعبلين',
        'اكسال',
        'البعنه',
        'البعينة نجيدات',
        'البقيعة',
        'البلدة القديمة أبواب',
        'التله الفرنسيه',
        'الثوري ابوطور',
        'الجش',
        'الجولان',
        'الرامة',
        'الرامه',
        'الرملة',
        'الرينه',
        'الزرازير',
        'الشبلة',
        'الشيخ جراح',
        'الشيخ دنون',
        'الضاحية',
        'الطور',
        'الطيبة',
        'الطيبة الزعبية',
        'الطيرة',
        'العزير',
        'العيسويه',
        'الغجر',
        'الفريديس',
        'القدس',
        'الكعبية',
        'اللد',
        'اللقية',
        'المركز',
        'المزرعة',
        'المزرعه',
        'المشهد',
        'المشيرفه',
        'المغار',
        'الناصرة',
        'الناصره العليا',
        'الناعورة',
        'النقب',
        'النين',
        'ام الغنم',
        'ام القطف',
        'ام بطين',
        'اور يهودا',
        'ايلات',
        'بات يام',
        'بار يعكوف',
        'باقة الغربية',
        'برطعة',
        'بسمة طبعون',
        'بقعاتا',
        'بني براك',
        'بيت جان',
        'بيتح تكفا',
        'بيت حنينا',
        'بيت صفافا',
        'بير السبع',
        'بير السكة',
        'بير المشاش',
        'بير المكسور',
        'ترشيحا',
        'تل ابيب',
        'تل السبع',
        'تل عراد',
        'جبل المكبر',
        'جت',
        'جت الجليل',
        'جديدة',
        'جديده المكر',
        'جسر الزرقاء',
        'جلجوليا',
        'جلجولية',
        'جنوب',
        'حجاجره',
        'حرفيش',
        'حريش',
        'حورة',
        'حولون',
        'خوالد',
        'دالية الكرمل',
        'دبورية',
        'دير الاسد',
        'دير حنا',
        'ديمونا',
        'راس العامود',
        'رعنانا',
        'رمات جان',
        'رمات خوڤاڤ',
        'رهط',
        'روش هعاين',
        'رومانه',
        'ريشون لتسيون',
        'زلفة',
        'زيمر',
        'ساجور',
        'سالم',
        'سلوان',
        'سولم',
        'شارع يافا',
        'شبلي',
        'شعب',
        'شعفاط',
        'شفاعمر',
        'شفاعمرو',
        'شقيب السلام',
        'شمال بعيد',
        'شمال قريب',
        'شمال وسط',
        'صفد',
        'صور باهر',
        'ضميده',
        'طباش',
        'طبريا',
        'طرعان',
        'طمرة',
        'طمرة الزعبية',
        'طوبا الزنجريه',
        'عارة',
        'عرابة',
        'عرابه',
        'عراد',
        'عرب العرامشة',
        'عرب الهيب',
        'عرعرة (الشمال)',
        'عرعره النقب',
        'عسفيا',
        'عطروت',
        'عفولة',
        'عكا',
        'عيلبون',
        'عيلوط',
        'عين السهلة',
        'عين قينيا',
        'عين ماهل',
        'فريديس',
        'فسوطه',
        'قرية دريجات',
        'قصر السر',
        'قلنسوة',
        'كابول',
        'كرمئيل',
        'كريات اونو',
        'كريات شمونه',
        'كسيفه',
        'كعيبة',
        'كفر برا',
        'كفر سميع',
        'كفر قاسم',
        'كفرقرع',
        'كفر قرع',
        'كفر كما',
        'كفر كنا',
        'كفر مصر',
        'كفر مندا',
        'كفر ياسيف',
        'كمانة',
        'كوكب ابو الهيجا',
        'كيبوتس دان',
        'مثلث',
        'مجد الكروم',
        'مجدل شمس',
        'مسعدة',
        'مشيرفة',
        'مصمص',
        'معاوية',
        'مقيبلة',
        'مكر',
        'منشية الزبدة',
        'مولادا',
        'ميسر',
        'نتانيا',
        'نتانياا',
        'نتانيااا',
        'نحف',
        'نين',
        'هرتسيليا',
        'واد سلامة',
        'وادي الجوز',
        'وادي الحمام',
        'وادي سلامه',
        'وادي عارة',
        'يافا',
        'يافة الناصرة',
        'يانوح',
        'يركا',
        'כפר סבא'
      ]
    },
    allowOtherCity: { type: Boolean, default: true }
  }
});

// Shipping configuration (admin configurable)
// When fixedFeeEnabled=true, backend shipping calculations will short-circuit to fixedFeeAmount.
settingsSchema.add({
  shipping: {
    fixedFeeEnabled: { type: Boolean, default: false },
    fixedFeeAmount: { type: Number, default: 0, min: 0 },
    // If enabled and order subtotal >= freeShippingMinSubtotal, shipping is free (cost 0)
    freeShippingEnabled: { type: Boolean, default: false },
    freeShippingMinSubtotal: { type: Number, default: 0, min: 0 }
  }
});

// Payments configuration (server-side; clientId may be exposed, secret must not be)
settingsSchema.add({
  payments: {
    paypal: {
      enabled: { type: Boolean, default: false },
      mode: { type: String, enum: ['sandbox', 'live'], default: 'sandbox' },
      clientId: { type: String, default: '' },
      secret: { type: String, default: '' }
    },
    // iCredit Payment Page (Rivhit) integration
    // Only non-secret fields are safe to expose; GroupPrivateToken must be masked in API responses
    icredit: {
      enabled: { type: Boolean, default: false },
      // Endpoint to obtain hosted payment URL
      apiUrl: { type: String, default: 'https://icredit.rivhit.co.il/API/PaymentPageRequest.svc/GetUrl' },
      // Preferred transport for PaymentPageRequest: 'auto' (JSON then SOAP), 'json' (JSON only), 'soap' (SOAP only)
      transport: { type: String, enum: ['auto','json','soap'], default: 'auto' },
      // Secret token provided by Rivhit/iCredit (write-only style; mask in API responses)
      groupPrivateToken: { type: String, default: '' },
      // Defaults for building requests (can be overridden per checkout session)
      redirectURL: { type: String, default: '' },
      ipnURL: { type: String, default: '' },
      exemptVAT: { type: Boolean, default: false },
      maxPayments: { type: Number, default: 1, min: 1 },
      creditFromPayment: { type: Number, default: 0, min: 0 },
      documentLanguage: { type: String, enum: ['he','en','ar',''], default: 'he' },
      createToken: { type: Boolean, default: false },
      hideItemList: { type: Boolean, default: false },
      emailBcc: { type: String, default: '' },
      defaultDiscount: { type: Number, default: 0, min: 0 }
    },
    // Visibility / availability flags for each checkout payment option
    visibility: {
      card: { type: Boolean, default: true },      // credit/debit card (local form)
      cod: { type: Boolean, default: true },       // cash on delivery
      paypal: { type: Boolean, default: true }     // controls showing PayPal option in addition to paypal.enabled
    }
  }
});

// Create default settings or migrate existing ones
settingsSchema.statics.createDefaultSettings = async function() {
  try {
    const settings = await this.findOne();
    if (!settings) {
      // No settings exist, create default ones
      await this.create({});
      console.log('Default store settings created successfully');
    } else {
      // Settings exist, check if we need to add new theme fields
  let needsUpdate = false;
  const updateData = {};
      
      // Check for missing theme fields and add defaults
      if (!settings.primaryColor) {
        updateData.primaryColor = '#3b82f6';
        needsUpdate = true;
      }
      if (!settings.secondaryColor) {
        updateData.secondaryColor = '#64748b';
        needsUpdate = true;
      }
      if (!settings.accentColor) {
        updateData.accentColor = '#f59e0b';
        needsUpdate = true;
      }
      if (!settings.textColor) {
        updateData.textColor = '#1f2937';
        needsUpdate = true;
      }
      if (!settings.backgroundColor) {
        updateData.backgroundColor = '#ffffff';
        needsUpdate = true;
      }
      if (!settings.fontFamily) {
        updateData.fontFamily = 'Inter, system-ui, sans-serif';
        needsUpdate = true;
      }
      if (!settings.productGridStyle) {
        updateData.productGridStyle = 'standard';
        needsUpdate = true;
      }
      if (typeof settings.showColorFilter === 'undefined') {
        updateData.showColorFilter = true;
        needsUpdate = true;
      }
      // Ensure new nav style fields exist
      const ensureField = (k, val) => { if (typeof settings[k] === 'undefined') { updateData[k] = val; needsUpdate = true; } };
      ensureField('navCategoryFontColor', '');
      ensureField('navCategoryFontSize', 'medium');
      ensureField('navPanelFontColor', '');
      ensureField('navPanelColumnActiveBgColor', '');
      ensureField('navPanelAccentColor', '');
      ensureField('navPanelHeaderColor', '');
  ensureField('searchBorderColor', '');
  // Ensure scroll-to-top fields exist
  ensureField('scrollTopBgColor', '');
  ensureField('scrollTopTextColor', '');
  ensureField('scrollTopHoverBgColor', '');
  ensureField('scrollTopPingColor', '');
      if (!settings.productCardStyle) {
        updateData.productCardStyle = 'modern';
        needsUpdate = true;
      }
      if (!settings.headerIcons) {
        updateData.headerIcons = {
          showLanguage: true,
          showCurrency: true,
          showSearch: true,
          showWishlist: true,
          showCart: true,
          showAccount: true
        };
        needsUpdate = true;
      }
      if (typeof settings.headerBackgroundColor === 'undefined') {
        updateData.headerBackgroundColor = '';
        needsUpdate = true;
      }
      if (typeof settings.headerTextColor === 'undefined') {
        updateData.headerTextColor = '';
        needsUpdate = true;
      }
      if (!settings.headerIconVariants) {
        updateData.headerIconVariants = {
          cart: 'shoppingBag',
          wishlist: 'heart'
        };
        needsUpdate = true;
      }
      if (!settings.headerIconAssets) {
        updateData.headerIconAssets = {
          cart: '',
          wishlist: '',
          account: '',
          search: '',
          language: '',
          currency: ''
        };
        needsUpdate = true;
      }
      // Ensure socialLinks.whatsapp exists
      if (!settings.socialLinks || typeof settings.socialLinks.whatsapp === 'undefined') {
        updateData.socialLinks = {
          ...(settings.socialLinks || {}),
          whatsapp: ''
        };
        needsUpdate = true;
      }
      // Ensure hero autoplay exists
      if (typeof settings.heroAutoplayMs === 'undefined') {
        updateData.heroAutoplayMs = 5000;
        needsUpdate = true;
      }
      // Ensure new ATC color fields exist (added after initial deployments)
      if (typeof settings.atcBgColor === 'undefined') {
        updateData.atcBgColor = '';
        needsUpdate = true;
      }
      if (typeof settings.atcTextColor === 'undefined') {
        updateData.atcTextColor = '';
        needsUpdate = true;
      }
      if (typeof settings.atcHoverBgColor === 'undefined') {
        updateData.atcHoverBgColor = '';
        needsUpdate = true;
      }
      // Ensure apiBaseUrl field exists
      if (typeof settings.apiBaseUrl === 'undefined') {
        updateData.apiBaseUrl = 'http://localhost:5000';
        needsUpdate = true;
      }
      // Ensure payments.paypal exists
      if (!settings.payments || !settings.payments.paypal) {
        updateData.payments = {
          ...(settings.payments || {}),
          paypal: {
            enabled: false,
            mode: 'sandbox',
            clientId: '',
            secret: ''
          },
          icredit: {
            enabled: false,
            apiUrl: 'https://icredit.rivhit.co.il/API/PaymentPageRequest.svc/GetUrl',
            transport: 'auto',
            groupPrivateToken: '',
            redirectURL: '',
            ipnURL: '',
            exemptVAT: false,
            maxPayments: 1,
            creditFromPayment: 0,
            documentLanguage: 'he',
            createToken: false,
            hideItemList: false,
            emailBcc: '',
            defaultDiscount: 0
          },
          visibility: {
            card: true,
            cod: true,
            paypal: true
          }
        };
        needsUpdate = true;
      }
      // Ensure payments.visibility exists if paypal existed previously
      if (settings.payments && !settings.payments.visibility) {
        updateData.payments = {
          ...(updateData.payments || settings.payments),
          visibility: {
            card: true,
            cod: true,
            paypal: true
          }
        };
        needsUpdate = true;
      }
      // Ensure payments.icredit exists if payments existed previously
      if (settings.payments && !settings.payments.icredit) {
        updateData.payments = {
          ...(updateData.payments || settings.payments),
          icredit: {
            enabled: false,
            apiUrl: 'https://icredit.rivhit.co.il/API/PaymentPageRequest.svc/GetUrl',
            transport: 'auto',
            groupPrivateToken: '',
            redirectURL: '',
            ipnURL: '',
            exemptVAT: false,
            maxPayments: 1,
            creditFromPayment: 0,
            documentLanguage: 'he',
            createToken: false,
            hideItemList: false,
            emailBcc: '',
            defaultDiscount: 0
          }
        };
        needsUpdate = true;
      }
      // Ensure googleAuth exists
      if (!settings.googleAuth) {
        updateData.googleAuth = { enabled: false, clientId: '' };
        needsUpdate = true;
      }
      // Ensure facebookAuth exists
      if (!settings.facebookAuth) {
        updateData.facebookAuth = { enabled: false, appId: '', appSecret: '', graphVersion: '' };
        needsUpdate = true;
      }
      // Ensure appleAuth exists
      if (!settings.appleAuth) {
        updateData.appleAuth = { enabled: false, clientId: '' };
        needsUpdate = true;
      }

      // Ensure a11y object and showReadPageButton exists (default true)
      if (!settings.a11y || typeof settings.a11y.showReadPageButton === 'undefined') {
        updateData.a11y = {
          ...(settings.a11y || {}),
          showReadPageButton: true
        };
        needsUpdate = true;
      }

      // Migrate legacy checkoutForm.cities (English defaults) to new Arabic/Hebrew list
      try {
        const legacyMarkers = ['Jerusalem', 'Ramallah', 'Nablus', 'Hebron'];
        const shouldMigrateCities = !settings.checkoutForm ||
          !Array.isArray(settings.checkoutForm.cities) ||
          settings.checkoutForm.cities.length === 0 ||
          settings.checkoutForm.cities.some(c => legacyMarkers.includes(String(c)));
        if (shouldMigrateCities) {
          const newCities = [
            'ابو قويدر','الجولان','الريحانية','الظهرية','ام الفحم','بديا','بيت شيمش','جفعات شموئل','جولس','حزمه','حسنيه','خضيرة','دير رافات','راس علي','رحوفوت','رمانه','رموت هشفيم','صندله','طيرة الكرمل','عين الاسد','عين حوض','كريات اتا','كسرى سميع','لهافيم','معليا','معلي افريم','نهاريا','نوف هجليل','هود هشارون','يوكنعام','ירושלים','الضفة الغربية','منطقة ابو غوش','الداخل','قرى الخليل','قباطية','اريحا','العيزرية','الزعيم','يطا','بيت لحم','الخليل','طوباس','طولكرم','سلفيت','ابو غوش','جنين','قلقيلية','ابو ديس','عين رافا','حيفا','عناتا','سخنين','ضواحي بيت لحم','مخيم شعفاط','ضواحي القدس','السواحرة الشرقية','إم الفحم','البيرة','عين نقوبا','كفر عقب','غزة','ضواحي رام الله','الرام','رام الله','نابلس','ابطن','ابو اسنان','ابو تلول','ابو سنان','ابو قرينات','اريال','اشدود','اشكلون','اعبلين','اكسال','البعنه','البعينة نجيدات','البقيعة','البلدة القديمة أبواب','التله الفرنسيه','الثوري ابوطور','الجش','الجولان','الرامة','الرامه','الرملة','الرينه','الزرازير','الشبلة','الشيخ جراح','الشيخ دنون','الضاحية','الطور','الطيبة','الطيبة الزعبية','الطيرة','العزير','العيسويه','الغجر','الفريديس','القدس','الكعبية','اللد','اللقية','المركز','المزرعة','المزرعه','المشهد','المشيرفه','المغار','الناصرة','الناصره العليا','الناعورة','النقب','النين','ام الغنم','ام القطف','ام بطين','اور يهودا','ايلات','بات يام','بار يعكوف','باقة الغربية','برطعة','بسمة طبعون','بقعاتا','بني براك','بيت جان','بيتح تكفا','بيت حنينا','بيت صفافا','بير السبع','بير السكة','بير المشاش','بير المكسور','ترشيحا','تل ابيب','تل السبع','تل عراد','جبل المكبر','جت','جت الجليل','جديدة','جديده المكر','جسر الزرقاء','جلجوليا','جلجولية','جنوب','حجاجره','حرفيش','حريش','حورة','حولون','خوالد','دالية الكرمل','دبورية','دير الاسد','دير حنا','ديمونا','راس العامود','رعنانا','رمات جان','رمات خوڤاڤ','رهط','روش هعاين','رومانه','ريشون لتسيون','زلفة','زيمر','ساجور','سالم','سلوان','سولم','شارع يافا','شبلي','شعب','شعفاط','شفاعمر','شفاعمرو','شقيب السلام','شمال بعيد','شمال قريب','شمال وسط','صفد','صور باهر','ضميده','طباش','طبريا','طرعان','طمرة','طمرة الزعبية','طوبا الزنجريه','عارة','عرابة','عرابه','عراد','عرب العرامشة','عرب الهيب','عرعرة (الشمال)','عرعره النقب','عسفيا','عطروت','عفولة','عكا','عيلبون','عيلوط','عين السهلة','عين قينيا','عين ماهل','فريديس','فسوطه','قرية دريجات','قصر السر','قلنسوة','كابول','كرمئيل','كريات اونو','كريات شمونه','كسيفه','كعيبة','كفر برا','كفر سميع','كفر قاسم','كفرقرع','كفر قرع','كفر كما','كفر كنا','كفر مصر','كفر مندا','كفر ياسيف','كمانة','كوكب ابو الهيجا','كيبوتس دان','مثلث','مجد الكروم','مجدل شمس','مسعدة','مشيرفة','مصمص','معاوية','مقيبلة','مكر','منشية الزبدة','مولادا','ميسر','نتانيا','نتانياا','نتانيااا','نحف','نين','هرتسيليا','واد سلامة','وادي الجوز','وادي الحمام','وادي سلامه','وادي عارة','يافا','يافة الناصرة','يانوح','يركا','כפר סבא'
          ];
          updateData.checkoutForm = {
            ...(settings.checkoutForm || {}),
            cities: newCities,
            allowOtherCity: typeof settings.checkoutForm?.allowOtherCity === 'boolean' ? settings.checkoutForm.allowOtherCity : true,
            showEmail: !!settings.checkoutForm?.showEmail,
            showLastName: !!settings.checkoutForm?.showLastName,
            showSecondaryMobile: !!settings.checkoutForm?.showSecondaryMobile,
            showCountry: !!settings.checkoutForm?.showCountry
          };
          needsUpdate = true;
        }
      } catch (e) {
        console.warn('CheckoutForm cities migration skipped:', e.message);
      }

      // Ensure multilingual city table exists (backfills from existing cities list)
      try {
        const hasTable = Array.isArray(settings.checkoutForm?.cityTable) && settings.checkoutForm.cityTable.length > 0;
        const willSetTable = Array.isArray(updateData.checkoutForm?.cityTable) && updateData.checkoutForm.cityTable.length > 0;
        if (!hasTable && !willSetTable) {
          const sourceCities = Array.isArray(updateData.checkoutForm?.cities) && updateData.checkoutForm.cities.length
            ? updateData.checkoutForm.cities
            : (Array.isArray(settings.checkoutForm?.cities) ? settings.checkoutForm.cities : []);
          if (sourceCities.length) {
            const normalizeEntry = (entry) => {
              if (entry && typeof entry === 'object') {
                return {
                  ar: typeof entry.ar === 'string' ? entry.ar : '',
                  en: typeof entry.en === 'string' ? entry.en : '',
                  he: typeof entry.he === 'string' ? entry.he : '',
                  areaGroup: typeof entry.areaGroup === 'string' ? entry.areaGroup : ''
                };
              }
              const value = typeof entry === 'string' ? entry : '';
              return { ar: value, en: '', he: '', areaGroup: '' };
            };
            if (!updateData.checkoutForm) {
              updateData.checkoutForm = { ...(settings.checkoutForm || {}) };
            }
            updateData.checkoutForm.cityTable = sourceCities
              .map(normalizeEntry)
              .filter(row => (row.ar || row.en || row.he));
            needsUpdate = true;
          }
        }
      } catch (e) {
        console.warn('CheckoutForm cityTable hydration skipped:', e.message);
      }
      
      if (needsUpdate) {
        await this.findByIdAndUpdate(settings._id, updateData);
        console.log('Existing settings migrated with new theme fields');
      }
    }
  } catch (error) {
    console.error('Error creating/migrating settings:', error);
  }
};

const Settings = mongoose.model('Settings', settingsSchema);

export default Settings;