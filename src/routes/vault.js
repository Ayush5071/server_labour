import express from 'express';
import ExcelJS from 'exceljs';
import Transaction from '../models/Transaction.js';
import Settings from '../models/Settings.js';

const router = express.Router();
const MASTER_PASSKEY = 'cipher15000';

// Helper function to format dates consistently for Excel (dd/mm/yyyy)
const formatExcelDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

// Get company name
router.get('/company-name', async (req, res) => {
  try {
    const settings = await Settings.findOne({ key: 'general' });
    res.json({ companyName: settings?.companyName || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set company name
router.post('/company-name', async (req, res) => {
  try {
    const { companyName } = req.body;
    let settings = await Settings.findOne({ key: 'general' });
    if (!settings) {
      settings = new Settings({ key: 'general' });
    }
    settings.companyName = companyName;
    await settings.save();
    res.json({ success: true, companyName: settings.companyName });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check if vault password is set
router.get('/status', async (req, res) => {
  try {
    const settings = await Settings.findOne({ key: 'general' });
    res.json({ 
      hasPassword: !!(settings && settings.vaultPassword) 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify vault password
router.post('/verify', async (req, res) => {
  try {
    const { password } = req.body;
    const settings = await Settings.findOne({ key: 'general' });
    
    if (!settings || !settings.vaultPassword) {
       // If no password set, any password works (or should be set first)
       // But UI should handle setting it.
       // Defaulting to true if no password set to avoid lockout, 
       // but strictly we should require setting it.
       return res.json({ success: true, message: 'No password set' });
    }

    if (settings.vaultPassword === password) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: 'Incorrect password' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Set or Change vault password (requires master passkey)
router.post('/password', async (req, res) => {
  try {
    const { passkey, newPassword } = req.body;
    
    if (passkey !== MASTER_PASSKEY) {
      return res.status(403).json({ error: 'Invalid master passkey' });
    }

    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    let settings = await Settings.findOne({ key: 'general' });
    if (!settings) {
      settings = new Settings({ key: 'general' });
    }

    settings.vaultPassword = newPassword;
    await settings.save();

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
      expenseByCategory: {},
      personBalances: {}
    };

    transactions.forEach(t => {
      if (t.type === 'transfer') {
        if (t.person) {
           summary.personBalances[t.person] = (summary.personBalances[t.person] || 0) - t.amount;
        }
        if (t.targetPerson) {
           summary.personBalances[t.targetPerson] = (summary.personBalances[t.targetPerson] || 0) + t.amount;
        }
        return;
      }

      // Calculate person balance if person is associated
      if (t.person) {
        if (!summary.personBalances[t.person]) {
            summary.personBalances[t.person] = 0;
        }
        
        if (t.type === 'income') {
            summary.personBalances[t.person] += t.amount;
        } else if (t.type === 'expense') {
            summary.personBalances[t.person] -= t.amount;
        }
      }

      if (t.type === 'income') {
        summary.totalIncome += t.amount;
        summary.incomeByCategory[t.category || 'Other'] = 
          (summary.incomeByCategory[t.category || 'Other'] || 0) + t.amount;
      } else if (t.type === 'expense') {
        summary.totalExpense += t.amount;
        summary.expenseByCategory[t.category || 'Other'] = 
          (summary.expenseByCategory[t.category || 'Other'] || 0) + t.amount;
      }
    });

    // Ensure all known persons are included (even with 0 balance) by reading distinct person names from the DB
    try {
      const distinctPersons = await Transaction.distinct('person');
      distinctPersons.filter(Boolean).forEach(p => {
        if (!summary.personBalances[p]) {
          summary.personBalances[p] = 0;
        }
      });
    } catch (e) {
      // Not critical, just log
      console.warn('Failed to include distinct persons in vault summary', e.message || e);
    }

    summary.balance = summary.totalIncome - summary.totalExpense;

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create transaction
router.post('/', async (req, res) => {
  try {
    const { type, amount, category, person, targetPerson, note, date } = req.body;

    if (!note) {
      return res.status(400).json({ error: 'Note is required' });
    }

    const transaction = new Transaction({
      type,
      amount,
      category,
      person: person || undefined,
      targetPerson: targetPerson || undefined,
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
    const { type, amount, category, person, targetPerson, note, date } = req.body;

    const transaction = await Transaction.findByIdAndUpdate(
      req.params.id,
      { type, amount, category, person: person || undefined, targetPerson: targetPerson || undefined, note, date: date ? new Date(date) : undefined },
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


// Export to Excel (last 100 transactions)
router.get('/export/excel', async (req, res) => {
  try {
    const transactions = await Transaction.find().sort({ date: -1 }).limit(100);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Worker Management System - Vault';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Vault Transactions');

    worksheet.columns = [
      { header: 'Date', key: 'date', width: 18 },
      { header: 'Type', key: 'type', width: 10 },
      { header: 'Category', key: 'category', width: 15 },
      { header: 'Amount', key: 'amount', width: 12 },
      { header: 'Person', key: 'person', width: 20 },
      { header: 'Target Person', key: 'targetPerson', width: 20 },
      { header: 'Note', key: 'note', width: 30 }
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };

    transactions.forEach(txn => {
      worksheet.addRow({
        date: txn.date ? formatExcelDate(txn.date) : '',
        type: txn.type,
        category: txn.category || '',
        amount: txn.amount,
        person: txn.person || '',
        targetPerson: txn.targetPerson || '',
        note: txn.note || ''
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const filename = `vault_transactions_last_100.xlsx`;

    res.json({ base64, filename });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
