import Booking from '../models/Booking.js';
import BookingAudit from '../models/BookingAudit.js';
import Settings from '../models/Settings.js';

// Static services list (could be moved to DB later)
const SERVICES = [
  { id: 'wash', name: 'Wash', durationMin: 30, price: 20 },
  { id: 'cut', name: 'Hair Cut', durationMin: 45, price: 35 },
  { id: 'nails', name: 'Nail Trim', durationMin: 15, price: 10 },
];

function generateDates(days = 14) {
  const out = [];
  const start = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    out.push(d);
  }
  return out;
}

const DEFAULT_SLOTS = ['07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00'];
const DEFAULT_SLOT_CAPACITY = parseInt(process.env.BOOKING_SLOT_CAPACITY || '4', 10);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const sanitizeSlotList = (list) => {
  if (!Array.isArray(list)) return [];
  return list
    .map(v => (v == null ? '' : String(v).trim()))
    .filter(Boolean)
    .filter(v => /^\d{2}:\d{2}$/.test(v));
};

const sanitizeDateSlotOverrides = (value) => {
  if (!value || typeof value !== 'object') return {};
  const source = value instanceof Map ? Object.fromEntries(value) : value;
  return Object.entries(source).reduce((acc, [date, slots]) => {
    if (!DATE_PATTERN.test(date)) return acc;
    const normalizedSlots = sanitizeSlotList(slots);
    if (!normalizedSlots.length) return acc;
    acc[date] = normalizedSlots;
    return acc;
  }, {});
};

const getSlotsForDate = (date, fallbackSlots, overridesMap) => {
  if (!overridesMap) return fallbackSlots;
  const override = overridesMap[date];
  if (Array.isArray(override) && override.length) return override;
  return fallbackSlots;
};

async function loadGroomingConfig() {
  try {
    const settings = await Settings.findOne().sort({ updatedAt: -1 }).select('grooming');
    const grooming = settings?.grooming || {};
    const slots = sanitizeSlotList(grooming.slots);
    const slotList = slots.length ? slots : DEFAULT_SLOTS;
    const slotCapacity = Number(grooming.slotCapacity) > 0 ? Number(grooming.slotCapacity) : DEFAULT_SLOT_CAPACITY;
    const dateSlotOverrides = sanitizeDateSlotOverrides(grooming.dateSlotOverrides);
    return { grooming, slots: slotList, slotCapacity, dateSlotOverrides };
  } catch {
    return { grooming: {}, slots: DEFAULT_SLOTS, slotCapacity: DEFAULT_SLOT_CAPACITY, dateSlotOverrides: {} };
  }
}

// Compute available dates considering admin-configured settings
async function computeAvailableDates(days = 14, groomingOverride) {
  try {
    let grooming = groomingOverride;
    if (!grooming) {
      const settings = await Settings.findOne().sort({ updatedAt: -1 }).select('grooming');
      grooming = settings?.grooming || {};
    }
    // Base window
    const windowDays = typeof grooming.bookingWindowDays === 'number' && grooming.bookingWindowDays > 0 ? grooming.bookingWindowDays : days;
    const baseDates = generateDates(windowDays);
    if (grooming.useDateWhitelist && Array.isArray(grooming.enabledDates) && grooming.enabledDates.length) {
      const set = new Set(baseDates);
      // Return only enabled dates that fall within the generated window, keep order
      return grooming.enabledDates.filter(d => set.has(d)).sort();
    }
    // Otherwise, exclude disabledDates from the base range
    const disabled = new Set((grooming.disabledDates || []).map(String));
    return baseDates.filter(d => !disabled.has(d));
  } catch (e) {
    // On error fallback to default consecutive range
    return generateDates(days);
  }
}

export async function getAvailability(req, res) {
  try {
    const { grooming, slots: slotList, slotCapacity, dateSlotOverrides } = await loadGroomingConfig();
    const dates = await computeAvailableDates(14, grooming);
    // Fetch existing bookings to compute remaining capacity (exclude cancelled)
    const existing = await Booking.find({ date: { $in: dates }, status: { $ne: 'cancelled' } }).select('date time').lean();
    // Build count map
    const countMap = {};
    existing.forEach(b => {
      if (!countMap[b.date]) countMap[b.date] = {};
      countMap[b.date][b.time] = (countMap[b.date][b.time] || 0) + 1;
    });
    const slots = {};
    const slotRemaining = {};
    dates.forEach(d => {
      const dailySlots = getSlotsForDate(d, slotList, dateSlotOverrides);
      slots[d] = dailySlots;
      slotRemaining[d] = {};
      dailySlots.forEach(t => {
        const used = countMap[d]?.[t] || 0;
        const remaining = Math.max(slotCapacity - used, 0);
        slotRemaining[d][t] = remaining;
      });
    });
    const heroBannerEnabled = grooming?.showHeroBanner !== false;
    const heroBannerImage = (() => {
      if (typeof grooming?.heroBannerImage === 'string') {
        const trimmed = grooming.heroBannerImage.trim();
        return trimmed.length ? trimmed : null;
      }
      return null;
    })();
    res.json({
      dates,
      slots,
      slotRemaining,
      capacity: slotCapacity,
      services: SERVICES,
      showHeroBanner: heroBannerEnabled,
      heroBannerImage
    });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load availability', error: e?.message || e });
  }
}

export async function createBooking(req, res) {
  try {
    const { date, time, services, petId } = req.body || {};
    if (!date || !time || !Array.isArray(services) || !services.length) {
      return res.status(400).json({ message: 'Missing required fields' });
    }
    const { slots: slotList, slotCapacity, dateSlotOverrides } = await loadGroomingConfig();
    const dates = await computeAvailableDates(30);
    if (!dates.includes(date)) {
      return res.status(400).json({ message: 'Date out of range' });
    }
    const slotsForDay = getSlotsForDate(date, slotList, dateSlotOverrides);
    if (!slotsForDay.includes(time)) {
      return res.status(400).json({ message: 'Invalid time slot' });
    }
    // Capacity check (exclude cancelled bookings)
    const existingCount = await Booking.countDocuments({ date, time, status: { $ne: 'cancelled' } });
    if (existingCount >= slotCapacity) {
      return res.status(409).json({ message: 'Slot full', capacity: slotCapacity, remaining: 0 });
    }
    // Map incoming service ids or objects
    let normalizedServices = [];
    services.forEach(s => {
      if (!s) return;
      if (typeof s === 'string') {
        const found = SERVICES.find(x => x.id === s);
        if (found) normalizedServices.push(found);
      } else if (s.id) {
        const found = SERVICES.find(x => x.id === s.id);
        if (found) normalizedServices.push(found);
      }
    });
    if (!normalizedServices.length) {
      return res.status(400).json({ message: 'No valid services' });
    }
    const booking = await Booking.create({
      date,
      time,
      services: normalizedServices,
      petId: petId || undefined,
      user: req.user?._id || undefined,
    });
    // Audit log
    try {
      await BookingAudit.create({
        booking: booking._id,
        action: 'create',
        by: req.user?._id || undefined,
        statusAfter: booking.status,
        meta: { services: booking.services.map(s => s.id) }
      });
    } catch {}
    // Compute remaining after creation
    const remainingAfter = Math.max(slotCapacity - (existingCount + 1), 0);
    res.status(201).json({ booking, capacity: slotCapacity, remaining: remainingAfter });
  } catch (e) {
    console.error('[booking][error]', e);
    res.status(500).json({ message: 'Failed to create booking', error: e?.message || e });
  }
}

export async function listBookings(req, res) {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const skip = (page - 1) * limit;
    // Filters
    const { status, date, from, to } = req.query;
    const q = {};
    if (status && typeof status === 'string') {
      q.status = status;
    }
    // date exact
    if (date && typeof date === 'string') {
      q.date = date;
    } else if (from || to) {
      // Build date range if at least one bound provided
      const range = {};
      if (from && typeof from === 'string') range.$gte = from;
      if (to && typeof to === 'string') range.$lte = to;
      if (Object.keys(range).length) q.date = range;
    }
    const total = await Booking.countDocuments(q);
    const bookings = await Booking.find(q)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', '_id email role');
    res.json({ page, total, pageSize: bookings.length, bookings, filters: { status: status || null, date: date || null, from: from || null, to: to || null } });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load bookings', error: e?.message || e });
  }
}

export async function updateBookingStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!id || !status) {
      return res.status(400).json({ message: 'Missing id or status' });
    }
    const allowed = ['pending','confirmed','completed','cancelled'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    const before = booking.status;
    booking.status = status;
    await booking.save();
    // Audit log
    try {
      await BookingAudit.create({
        booking: booking._id,
        action: status === 'cancelled' ? 'cancel' : 'status-change',
        by: req.user?._id || undefined,
        statusBefore: before,
        statusAfter: booking.status,
      });
    } catch {}
    res.json({ booking });
  } catch (e) {
    res.status(500).json({ message: 'Failed to update booking', error: e?.message || e });
  }
}

export async function getBookingById(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const booking = await Booking.findById(id).populate('user', '_id email role');
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    res.json({ booking });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load booking', error: e?.message || e });
  }
}

export async function deleteBooking(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const booking = await Booking.findById(id).populate('user', '_id email role');
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    await BookingAudit.deleteMany({ booking: booking._id });
    await Booking.deleteOne({ _id: booking._id });

    res.json({ success: true, booking });
  } catch (e) {
    res.status(500).json({ message: 'Failed to delete booking', error: e?.message || e });
  }
}

export async function cancelBooking(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    // Permission: admin or owner
    const isAdmin = req.user?.role === 'admin';
    const isOwner = req.user && booking.user && String(booking.user) === String(req.user._id);
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ message: 'Not authorized to cancel this booking' });
    }
    if (booking.status === 'cancelled') {
      return res.status(200).json({ booking, message: 'Already cancelled' });
    }
    const before = booking.status;
    booking.status = 'cancelled';
    await booking.save();
    try {
      await BookingAudit.create({
        booking: booking._id,
        action: 'cancel',
        by: req.user?._id || undefined,
        statusBefore: before,
        statusAfter: booking.status,
      });
    } catch {}
    res.json({ booking });
  } catch (e) {
    res.status(500).json({ message: 'Failed to cancel booking', error: e?.message || e });
  }
}

export async function getBookingAudit(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const exists = await Booking.findById(id).select('_id');
    if (!exists) return res.status(404).json({ message: 'Booking not found' });
    const logs = await BookingAudit.find({ booking: id }).sort({ createdAt: -1 }).populate('by', '_id email role');
    res.json({ logs });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load audit', error: e?.message || e });
  }
}

// Authenticated user: list own bookings with optional status/date filters
export async function getMyBookings(req, res) {
  try {
    if (!req.user) return res.status(401).json({ message: 'Authentication required' });
    const { status, date } = req.query;
    const q = { user: req.user._id };
    if (status && typeof status === 'string') q.status = status;
    if (date && typeof date === 'string') q.date = date;
    const bookings = await Booking.find(q).sort({ date: 1, time: 1 });
    res.json({ bookings, count: bookings.length });
  } catch (e) {
    res.status(500).json({ message: 'Failed to load user bookings', error: e?.message || e });
  }
}

// User or admin: reschedule booking (change date/time) if capacity allows
export async function rescheduleBooking(req, res) {
  try {
    const { id } = req.params;
    const { date: newDate, time: newTime } = req.body || {};
    if (!id || !newDate || !newTime) return res.status(400).json({ message: 'Missing id, date or time' });
    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    // Permission: admin or owner
    const isAdmin = req.user?.role === 'admin';
    const isOwner = req.user && booking.user && String(booking.user) === String(req.user._id);
    if (!isAdmin && !isOwner) return res.status(403).json({ message: 'Not authorized to reschedule this booking' });
    // Prevent reschedule if cancelled or completed
    if (['cancelled','completed'].includes(booking.status)) {
      return res.status(400).json({ message: 'Cannot reschedule a completed or cancelled booking' });
    }
    // Validate new date/time in availability range
    const { slots: slotList, slotCapacity, dateSlotOverrides } = await loadGroomingConfig();
    const dates = await computeAvailableDates(30);
    if (!dates.includes(newDate)) return res.status(400).json({ message: 'Date out of range' });
    const slotsForDay = getSlotsForDate(newDate, slotList, dateSlotOverrides);
    if (!slotsForDay.includes(newTime)) return res.status(400).json({ message: 'Invalid time slot' });
    // Capacity check (exclude cancelled) for target slot excluding current booking if same slot
    const existingCount = await Booking.countDocuments({ date: newDate, time: newTime, status: { $ne: 'cancelled' }, _id: { $ne: booking._id } });
    if (existingCount >= slotCapacity) {
      return res.status(409).json({ message: 'Target slot full', capacity: slotCapacity, remaining: 0 });
    }
    const beforeDate = booking.date;
    const beforeTime = booking.time;
    booking.date = newDate;
    booking.time = newTime;
    await booking.save();
    try {
      await BookingAudit.create({
        booking: booking._id,
        action: 'reschedule',
        by: req.user?._id || undefined,
        statusBefore: booking.status,
        statusAfter: booking.status,
        meta: { from: { date: beforeDate, time: beforeTime }, to: { date: newDate, time: newTime } }
      });
    } catch {}
    const remainingAfter = Math.max(slotCapacity - (existingCount + 1), 0);
    res.json({ booking, capacity: slotCapacity, remaining: remainingAfter });
  } catch (e) {
    res.status(500).json({ message: 'Failed to reschedule booking', error: e?.message || e });
  }
}
