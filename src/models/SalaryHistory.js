import mongoose from 'mongoose';

const salaryHistorySchema = new mongoose.Schema({
  // Period information
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
  // Worker salary records - snapshot at save time
  records: [{
    worker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Worker',
      required: true
    },
    workerName: String,
    workerId: String,
    hourlyRate: Number,
    totalHoursWorked: Number,
    totalPay: Number,
    deposit: {
      type: Number,
      default: 0
    },
    finalAmount: Number,
    advanceBalanceAtSave: Number
  }],
  // Summary totals
  totalHours: Number,
  totalAmount: Number,
  totalDeposit: Number,
  totalFinal: Number,
  // Metadata
  notes: String,
  isSaved: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Create index for finding saved reports by date
salaryHistorySchema.index({ savedDate: -1 });
salaryHistorySchema.index({ periodStart: 1, periodEnd: 1 });

export default mongoose.model('SalaryHistory', salaryHistorySchema);
