import mongoose from 'mongoose';

const dailyEntrySchema = new mongoose.Schema({
  worker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['present', 'absent', 'holiday', 'half-day'],
    default: 'present'
  },
  hoursWorked: {
    type: Number,
    default: 0
  },
  totalPay: {
    type: Number,
    default: 0
  },
  notes: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Compound index to prevent duplicate entries for same worker on same date
dailyEntrySchema.index({ worker: 1, date: 1 }, { unique: true });
dailyEntrySchema.index({ date: 1 });

export default mongoose.model('DailyEntry', dailyEntrySchema);
