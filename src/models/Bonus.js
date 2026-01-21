import mongoose from 'mongoose';

const bonusSchema = new mongoose.Schema({
  year: {
    type: Number,
    required: true
  },
  periodStart: {
    type: Date
  },
  periodEnd: {
    type: Date
  },
  worker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    required: true
  },
  // Base bonus = hourlyRate × 8 hours × 30 days
  hourlyRate: {
    type: Number,
    default: 0
  },
  baseBonusAmount: {
    type: Number,
    required: true
  },
  totalDaysWorked: {
    type: Number,
    default: 0
  },
  totalDaysAbsent: {
    type: Number,
    default: 0
  },
  absentPenaltyPerDay: {
    type: Number,
    default: 0
  },
  totalPenalty: {
    type: Number,
    default: 0
  },
  // Advance repayment deducted from bonus
  advanceDeduction: {
    type: Number,
    default: 0
  },
  // Extra bonus amount (additional money given)
  extraBonus: {
    type: Number,
    default: 0
  },
  // Current advance balance at time of calculation
  currentAdvanceBalance: {
    type: Number,
    default: 0
  },
  finalBonusAmount: {
    type: Number,
    required: true
  },
  amountPaid: {
    type: Number,
    default: 0
  },
  isPaid: {
    type: Boolean,
    default: false
  },
  paidDate: {
    type: Date
  },
  notes: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

bonusSchema.index({ year: 1, worker: 1 });
bonusSchema.index({ periodStart: 1, periodEnd: 1, worker: 1 });

export default mongoose.model('Bonus', bonusSchema);
