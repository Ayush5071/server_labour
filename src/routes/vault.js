import express from 'express';
import Transaction from '../models/Transaction.js';

const router = express.Router();

// Get all transactions with filters
router.get('/', async (req, res) => {
  try {
    const { type, startDate, endDate, category } = req.query;
    const filter = {};

    if (type) filter.type = type;
    if (category) filter.category = category;

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    const transactions = await Transaction.find(filter).sort({ date: -1 });
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get summary
router.get('/summary', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const filter = {};

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    const transactions = await Transaction.find(filter);

    const summary = {
      totalIncome: 0,
      totalExpense: 0,
      balance: 0,
      incomeByCategory: {},
      expenseByCategory: {}
    };

    transactions.forEach(t => {
      if (t.type === 'income') {
        summary.totalIncome += t.amount;
        summary.incomeByCategory[t.category || 'Other'] = 
          (summary.incomeByCategory[t.category || 'Other'] || 0) + t.amount;
      } else {
        summary.totalExpense += t.amount;
        summary.expenseByCategory[t.category || 'Other'] = 
          (summary.expenseByCategory[t.category || 'Other'] || 0) + t.amount;
      }
    });

    summary.balance = summary.totalIncome - summary.totalExpense;

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create transaction
router.post('/', async (req, res) => {
  try {
    const { type, amount, category, note, date } = req.body;

    if (!note) {
      return res.status(400).json({ error: 'Note is required' });
    }

    const transaction = new Transaction({
      type,
      amount,
      category,
      note,
      date: date ? new Date(date) : new Date()
    });

    await transaction.save();
    res.status(201).json(transaction);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update transaction
router.put('/:id', async (req, res) => {
  try {
    const { type, amount, category, note, date } = req.body;

    const transaction = await Transaction.findByIdAndUpdate(
      req.params.id,
      { type, amount, category, note, date: date ? new Date(date) : undefined },
      { new: true, runValidators: true }
    );

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json(transaction);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete transaction
router.delete('/:id', async (req, res) => {
  try {
    const transaction = await Transaction.findByIdAndDelete(req.params.id);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
