import mongoose from 'mongoose';

const advanceSchema = new mongoose.Schema({
  worker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    required: true
  },
  type: {
    type: String,
    enum: ['advance', 'repayment', 'deposit'],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  notes: {
    type: String,
    trim: true
  },
  balanceAfter: {
    type: Number,
    required: true
  }
}, {
  timestamps: true
});

advanceSchema.index({ worker: 1, date: -1 });
advanceSchema.index({ date: -1 });

export default mongoose.model('Advance', advanceSchema);
