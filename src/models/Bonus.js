import mongoose from 'mongoose';

const bonusSchema = new mongoose.Schema({
  year: {
    type: Number,
    required: true
  },
  worker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    required: true
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
  advanceDeduction: {
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

bonusSchema.index({ year: 1, worker: 1 }, { unique: true });

export default mongoose.model('Bonus', bonusSchema);
