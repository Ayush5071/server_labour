import mongoose from 'mongoose';

const bonusHistorySchema = new mongoose.Schema({
  // Period information
  year: {
    type: Number,
    required: true
  },
  periodStart: {
    type: Date,
    required: true
  },
  periodEnd: {
    type: Date,
    required: true
  },
  savedDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  // Worker bonus records - snapshot at save time
  records: [{
    worker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Worker',
      required: true
    },
    workerName: String,
    workerId: String,
    hourlyRate: Number,
    baseBonusAmount: Number,
    totalDaysWorked: Number,
    totalDaysAbsent: Number,
    totalPenalty: Number,
    advanceDeduction: Number,
    extraBonus: Number,
    deposit: {
      type: Number,
      default: 0
    },
    payout: { // Already paid deduction
      type: Number,
      default: 0
    },
    newAdvance: { // New advance given
      type: Number,
      default: 0
    },
    finalBonusAmount: Number,
    amountToGiveEmployee: Number,
    advanceBalanceAtSave: Number
  }],
  // Summary totals
  totalBaseBonusAmount: Number,
  totalPenalty: Number,
  totalAdvanceDue: Number,
  totalAdvanceDeduction: Number,
  totalExtraBonus: Number,
  totalDeposit: Number,
  totalPayout: Number,
  totalNewAdvance: Number,
  totalFinalAmount: Number,
  // Metadata
  notes: String,
  isSaved: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Create index for finding saved bonuses by date
bonusHistorySchema.index({ savedDate: -1 });
bonusHistorySchema.index({ year: 1 });
bonusHistorySchema.index({ periodStart: 1, periodEnd: 1 });

export default mongoose.model('BonusHistory', bonusHistorySchema);
