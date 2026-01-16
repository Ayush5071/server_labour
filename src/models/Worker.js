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
  dailyPay: {
    type: Number,
    required: true
  },
  overtimeRate: {
    type: Number,
    required: true,
    default: 1.5 // multiplier for overtime
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
  totalEarnings: {
    type: Number,
    default: 0
  },
  totalOvertimeHours: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

export default mongoose.model('Worker', workerSchema);
