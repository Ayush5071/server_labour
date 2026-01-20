import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  worker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  type: {
    type: String,
    enum: ['salary', 'bonus', 'advance_repayment', 'other'],
    required: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  periodStart: {
    type: Date
  },
  periodEnd: {
    type: Date
  },
  advanceDeducted: {
    type: Number,
    default: 0
  },
  netAmount: {
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

paymentSchema.index({ worker: 1, date: -1 });
paymentSchema.index({ date: -1 });

export default mongoose.model('Payment', paymentSchema);
