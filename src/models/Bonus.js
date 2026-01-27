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
  // Minimum absent threshold (lowest absents among all workers)
  minAbsentThreshold: {
    type: Number,
    default: 0
  },
  // Extra absents above the threshold
  extraAbsents: {
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
  // Employee deposit towards advance repayment
  employeeDeposit: {
    type: Number,
    default: 0
  },
  // Current advance balance at time of calculation
  currentAdvanceBalance: {
    type: Number,
    default: 0
  },
  // Calculated final bonus after all deductions and deposits
  finalBonusAmount: {
    type: Number,
    required: true
  },
  // The amount actually to be given to employee (bonus - advanceDeduction - employeeDeposit + extraBonus)
  amountToGiveEmployee: {
    type: Number,
    default: 0
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
  },
  baseBonus: { type: Number, default: 0 },
  penalty: { type: Number, default: 0 },
  deposit: { type: Number, default: 0 },
  finalAmount: { type: Number, default: 0 },
  absentDays: { type: Number, default: 0 },
  transactions: [{
    type: { type: String, enum: ['bonus-deposit', 'bonus-refund', 'extra-bonus', 'other'] },
    amount: Number,
    date: Date,
    note: String
  }],
  period: {
    startDate: Date,
    endDate: Date
  }
}, {
  timestamps: true
});

// Pre-save hook to always recalculate finalAmount
bonusSchema.pre('save', function(next) {
  // Final Amount = Base - Penalty + ExtraBonus - Deposit
  this.finalAmount = 
    (this.baseBonus || 0) - 
    (this.penalty || 0) + 
    (this.extraBonus || 0) - 
    (this.deposit || 0);
  next();
});

bonusSchema.index({ year: 1, worker: 1 });
bonusSchema.index({ periodStart: 1, periodEnd: 1, worker: 1 });

export default mongoose.model('Bonus', bonusSchema);
