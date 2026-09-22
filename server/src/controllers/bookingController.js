import Joi from 'joi';
import { Booking } from '../models/Booking.js';

const objectId = Joi.string().hex().length(24);

const createSchema = Joi.object({
  roomNumber: Joi.string().trim().min(1).max(20).required(),
  startDate: Joi.date().required(),
  endDate: Joi.date().required(),
  purpose: Joi.string().trim().max(200).allow(''),
  bookedBy: objectId
});

const updateSchema = Joi.object({
  roomNumber: Joi.string().trim().min(1).max(20),
  startDate: Joi.date(),
  endDate: Joi.date(),
  purpose: Joi.string().trim().max(200).allow(''),
  bookedBy: objectId
}).min(1);

// Two ranges overlap when each starts before the other one ends.
// Strict $lt/$gt, so back-to-back bookings (one ends exactly when the next
// starts) are allowed. excludeId keeps an update from conflicting with itself.
async function findConflict(roomNumber, startDate, endDate, excludeId) {
  const query = {
    roomNumber,
    startDate: { $lt: endDate },
    endDate: { $gt: startDate }
  };
  if (excludeId) query._id = { $ne: excludeId };
  return Booking.findOne(query);
}

// GET /api/bookings
export async function getAllBookings(req, res, next) {
  try {
    const bookings = await Booking.find()
      .populate('bookedBy', 'name email')
      .sort({ startDate: 1 });
    res.json({ bookings });
  } catch (err) { next(err); }
}

// GET /api/bookings/:id
export async function getBooking(req, res, next) {
  try {
    const booking = await Booking.findById(req.params.id).populate('bookedBy', 'name email');
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    res.json({ booking });
  } catch (err) { next(err); }
}

// POST /api/bookings
export async function createBooking(req, res, next) {
  try {
    const { value, error } = createSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) return res.status(400).json({ message: error.message });

    // Joi validates the types but not the relationship between the two dates.
    if (value.startDate >= value.endDate) {
      return res.status(400).json({ message: 'startDate must be before endDate' });
    }

    const conflict = await findConflict(value.roomNumber, value.startDate, value.endDate);
    if (conflict) {
      return res.status(409).json({
        message: 'Room already booked for that time range',
        conflictsWith: conflict._id
      });
    }

    const booking = await Booking.create(value);
    res.status(201).json({ booking });
  } catch (err) { next(err); }
}

// PATCH /api/bookings/:id
export async function updateBooking(req, res, next) {
  try {
    const { value, error } = updateSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) return res.status(400).json({ message: error.message });

    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    // Merge first: a partial PATCH (e.g. only endDate) still has to be checked
    // against the resulting range, not against the fields that were sent.
    booking.set(value);

    if (booking.startDate >= booking.endDate) {
      return res.status(400).json({ message: 'startDate must be before endDate' });
    }

    const conflict = await findConflict(
      booking.roomNumber,
      booking.startDate,
      booking.endDate,
      booking._id
    );
    if (conflict) {
      return res.status(409).json({
        message: 'Room already booked for that time range',
        conflictsWith: conflict._id
      });
    }

    await booking.save();
    await booking.populate('bookedBy', 'name email');
    res.json({ booking });
  } catch (err) { next(err); }
}

// DELETE /api/bookings/:id
export async function deleteBooking(req, res, next) {
  try {
    const doc = await Booking.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Booking not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
}
