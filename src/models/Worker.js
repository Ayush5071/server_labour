import mongoose from 'mongoose';

const workerSchema = new mongoose.Schema({
  workerId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  dailyWorkingHours: {
    type: Number,
    required: true,
    default: 8
  },
  hourlyRate: {
    type: Number,
    required: true
  },
  bankDetails: {
    bankName: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    ifscCode: { type: String, trim: true }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Advance tracking
  advanceBalance: {
    type: Number,
    default: 0
  },
  totalAdvanceTaken: {
    type: Number,
    default: 0
  },
  totalAdvanceRepaid: {
    type: Number,
    default: 0
  },
  // Stats
  totalEarnings: {
    type: Number,
    default: 0
  },
  totalDaysWorked: {
    type: Number,
    default: 0
  },
  totalDaysAbsent: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

export default mongoose.model('Worker', workerSchema);
