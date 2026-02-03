import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    default: 'general'
  },
  vaultPassword: {
    type: String,
    default: null
  }
}, { timestamps: true });

export default mongoose.model('Settings', settingsSchema);
