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
  hoursWorked: {
    type: Number,
    required: true
  },
  regularHours: {
    type: Number,
    required: true
  },
  overtimeHours: {
    type: Number,
    default: 0
  },
  regularPay: {
    type: Number,
    required: true
  },
  overtimePay: {
    type: Number,
    default: 0
  },
  totalPay: {
    type: Number,
    required: true
  },
  notes: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Index for efficient queries
dailyEntrySchema.index({ worker: 1, date: 1 });
dailyEntrySchema.index({ date: 1 });

export default mongoose.model('DailyEntry', dailyEntrySchema);
