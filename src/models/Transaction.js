import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['income', 'expense', 'transfer'],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  category: {
    type: String,
    trim: true
  },
  person: {
    type: String,
    enum: ['Biswajit -1', 'Biswajit-2', 'Rajkumar', 'Manoj'],
    trim: true,
    required: false
  },
  targetPerson: {
    type: String,
    enum: ['Biswajit -1', 'Biswajit-2', 'Rajkumar', 'Manoj'],
    trim: true,
    required: false
  },
  note: {
    type: String,
    required: true,
    trim: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  }
}, {
  timestamps: true
});

transactionSchema.index({ date: -1 });
transactionSchema.index({ type: 1, date: -1 });

export default mongoose.model('Transaction', transactionSchema);
