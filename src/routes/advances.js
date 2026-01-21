import express from 'express';
import ExcelJS from 'exceljs';
import Advance from '../models/Advance.js';
import Worker from '../models/Worker.js';
import Payment from '../models/Payment.js';
import DailyEntry from '../models/DailyEntry.js';

const router = express.Router();

const months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Get all advances with filters
router.get('/', async (req, res) => {
  try {
    const { workerId, type, startDate, endDate } = req.query;
    const filter = {};

    if (workerId) filter.worker = workerId;
    if (type) filter.type = type;

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    const advances = await Advance.find(filter)
      .populate('worker', 'name workerId advanceBalance')
      .sort({ date: -1 });

    res.json(advances);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get advance summary for all workers
router.get('/summary', async (req, res) => {
  try {
    const workers = await Worker.find({ isActive: true })
      .select('name workerId advanceBalance totalAdvanceTaken totalAdvanceRepaid')
      .sort({ name: 1 });

    res.json(workers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get advance history for a worker
router.get('/worker/:workerId', async (req, res) => {
  try {
    const worker = await Worker.findById(req.params.workerId);
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    const advances = await Advance.find({ worker: req.params.workerId })
      .sort({ date: -1 });

    res.json({
      worker: {
        _id: worker._id,
        name: worker.name,
        workerId: worker.workerId,
        advanceBalance: worker.advanceBalance,
        totalAdvanceTaken: worker.totalAdvanceTaken,
        totalAdvanceRepaid: worker.totalAdvanceRepaid
      },
      history: advances
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Give advance to worker
router.post('/give', async (req, res) => {
  try {
    const { workerId, amount, notes, date } = req.body;

    const worker = await Worker.findById(workerId);
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    const newBalance = worker.advanceBalance + amount;

    const advance = new Advance({
      worker: workerId,
      type: 'advance',
      amount,
      date: date ? new Date(date) : new Date(),
      notes,
      balanceAfter: newBalance
    });

    await advance.save();

    await Worker.findByIdAndUpdate(workerId, {
      advanceBalance: newBalance,
      $inc: { totalAdvanceTaken: amount }
    });

    const populatedAdvance = await Advance.findById(advance._id)
      .populate('worker', 'name workerId advanceBalance');

    res.status(201).json(populatedAdvance);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Record advance repayment
router.post('/repay', async (req, res) => {
  try {
    const { workerId, amount, notes, date } = req.body;

    const worker = await Worker.findById(workerId);
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    if (amount > worker.advanceBalance) {
      return res.status(400).json({ error: 'Repayment amount exceeds advance balance' });
    }

    const newBalance = worker.advanceBalance - amount;

    const advance = new Advance({
      worker: workerId,
      type: 'repayment',
      amount,
      date: date ? new Date(date) : new Date(),
      notes,
      balanceAfter: newBalance
    });

    await advance.save();

    await Worker.findByIdAndUpdate(workerId, {
      advanceBalance: newBalance,
      $inc: { totalAdvanceRepaid: amount }
    });

    const populatedAdvance = await Advance.findById(advance._id)
      .populate('worker', 'name workerId advanceBalance');

    res.status(201).json(populatedAdvance);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Make salary payment
router.post('/salary', async (req, res) => {
  try {
    const { workerId, periodStart, periodEnd, advanceDeduction, notes } = req.body;

    const worker = await Worker.findById(workerId);
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    // Calculate total earnings for period
    const entries = await DailyEntry.find({
      worker: workerId,
      date: { 
        $gte: new Date(periodStart), 
        $lte: new Date(periodEnd) 
      }
    });

    const totalEarnings = entries.reduce((sum, entry) => sum + entry.totalPay, 0);
    const deduction = Math.min(advanceDeduction || 0, worker.advanceBalance);
    const netAmount = totalEarnings - deduction;

    // Create payment record
    const payment = new Payment({
      worker: workerId,
      amount: totalEarnings,
      type: 'salary',
      date: new Date(),
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      advanceDeducted: deduction,
      netAmount,
      notes
    });

    await payment.save();

    // Update advance balance if deduction was made
    if (deduction > 0) {
      const newBalance = worker.advanceBalance - deduction;

      await Advance.create({
        worker: workerId,
        type: 'repayment',
        amount: deduction,
        date: new Date(),
        notes: `Deducted from salary (${periodStart} to ${periodEnd})`,
        balanceAfter: newBalance
      });

      await Worker.findByIdAndUpdate(workerId, {
        advanceBalance: newBalance,
        $inc: { totalAdvanceRepaid: deduction, totalEarnings: netAmount }
      });
    } else {
      await Worker.findByIdAndUpdate(workerId, {
        $inc: { totalEarnings: netAmount }
      });
    }

    const populatedPayment = await Payment.findById(payment._id)
      .populate('worker', 'name workerId advanceBalance');

    res.status(201).json(populatedPayment);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get payment history
router.get('/payments', async (req, res) => {
  try {
    const { workerId, type, startDate, endDate } = req.query;
    const filter = {};

    if (workerId) filter.worker = workerId;
    if (type) filter.type = type;

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    const payments = await Payment.find(filter)
      .populate('worker', 'name workerId')
      .sort({ date: -1 });

    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get worker payment details for a period
router.get('/calculate/:workerId', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const worker = await Worker.findById(req.params.workerId);
    
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    const entries = await DailyEntry.find({
      worker: req.params.workerId,
      date: { 
        $gte: new Date(startDate), 
        $lte: new Date(endDate) 
      }
    }).sort({ date: 1 });

    const totalHours = entries.reduce((sum, e) => sum + e.hoursWorked, 0);
    const totalPay = entries.reduce((sum, e) => sum + e.totalPay, 0);
    const daysPresent = entries.filter(e => e.status === 'present' || e.status === 'holiday').length;
    const daysAbsent = entries.filter(e => e.status === 'absent').length;

    res.json({
      worker: {
        _id: worker._id,
        name: worker.name,
        workerId: worker.workerId,
        hourlyRate: worker.hourlyRate || (worker.dailyPay ? worker.dailyPay / worker.dailyWorkingHours : 0),
        advanceBalance: worker.advanceBalance
      },
      period: { startDate, endDate },
      summary: {
        totalHours,
        totalPay,
        daysPresent,
        daysAbsent,
        advanceBalance: worker.advanceBalance
      },
      entries
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Record deposit (reduces advance balance)
router.post('/deposit', async (req, res) => {
  try {
    const { workerId, amount, notes, date } = req.body;

    const worker = await Worker.findById(workerId);
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    const newBalance = Math.max(0, worker.advanceBalance - amount);

    const advance = new Advance({
      worker: workerId,
      type: 'deposit',
      amount,
      date: date ? new Date(date) : new Date(),
      notes: notes || 'Deposit',
      balanceAfter: newBalance
    });

    await advance.save();

    await Worker.findByIdAndUpdate(workerId, {
      advanceBalance: newBalance,
      $inc: { totalAdvanceRepaid: amount }
    });

    const populatedAdvance = await Advance.findById(advance._id)
      .populate('worker', 'name workerId advanceBalance');

    res.status(201).json(populatedAdvance);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Export dues to Excel with colored cells
router.get('/export/dues', async (req, res) => {
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

    const advances = await Advance.find(filter)
      .populate('worker', 'name workerId advanceBalance')
      .sort({ date: -1 });

    // Get all workers with advances
    const workers = await Worker.find({ isActive: true })
      .select('name workerId advanceBalance totalAdvanceTaken totalAdvanceRepaid')
      .sort({ name: 1 });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Worker Management System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Labour Dues Chart');

    // Format dates for title
    const startDateStr = startDate ? new Date(startDate).toLocaleDateString('en-IN') : 'Beginning';
    const endDateStr = endDate ? new Date(endDate).toLocaleDateString('en-IN') : 'Present';

    // Title
    worksheet.mergeCells('A1:G1');
    worksheet.getCell('A1').value = `Labour Dues Chart (${startDateStr} to ${endDateStr})`;
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.addRow([]);

    // Headers
    const headerRow = worksheet.addRow([
      'S.No',
      'Worker ID',
      'Worker Name',
      'Date',
      'Type',
      'Amount',
      'Balance After'
    ]);

    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    // Data rows with colored cells
    advances.forEach((adv, index) => {
      const row = worksheet.addRow([
        index + 1,
        adv.worker?.workerId || '',
        adv.worker?.name || '',
        new Date(adv.date).toLocaleDateString('en-IN'),
        adv.type === 'advance' ? 'Advance' : (adv.type === 'deposit' ? 'Deposit' : 'Repayment'),
        adv.amount,
        adv.balanceAfter
      ]);

      row.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };

        // Color the row based on type
        if (adv.type === 'advance') {
          // Light red for advance
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFCDD2' } // Light red
          };
        } else {
          // Light green for deposit/repayment
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFC8E6C9' } // Light green
          };
        }
      });
    });

    // Summary section
    worksheet.addRow([]);
    worksheet.addRow([]);
    
    const summaryTitle = worksheet.addRow(['Worker Summary']);
    summaryTitle.font = { bold: true, size: 14 };

    worksheet.addRow([]);

    const summaryHeader = worksheet.addRow([
      'S.No',
      'Worker ID',
      'Worker Name',
      'Total Taken',
      'Total Repaid',
      'Current Balance'
    ]);
    summaryHeader.font = { bold: true };
    summaryHeader.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    workers.filter(w => w.advanceBalance > 0 || w.totalAdvanceTaken > 0).forEach((worker, index) => {
      const row = worksheet.addRow([
        index + 1,
        worker.workerId,
        worker.name,
        worker.totalAdvanceTaken || 0,
        worker.totalAdvanceRepaid || 0,
        worker.advanceBalance
      ]);

      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });

    // Column widths
    worksheet.columns = [
      { width: 8 },
      { width: 15 },
      { width: 25 },
      { width: 15 },
      { width: 15 },
      { width: 15 },
      { width: 15 }
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const filename = `labour_dues_chart_${startDateStr.replace(/\//g, '-')}_to_${endDateStr.replace(/\//g, '-')}.xlsx`;

    res.json({ base64, filename });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
