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

    // Support pagination: limit & skip
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
    const skip = req.query.skip ? parseInt(req.query.skip, 10) : null;

    let q = Advance.find(filter)
      .populate('worker', 'name workerId advanceBalance')
      .sort({ date: -1 });

    if (skip) q = q.skip(skip);
    if (limit) q = q.limit(limit);

    const advances = await q.exec();

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

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid deposit amount' });
    }

    const currentBalance = worker.advanceBalance || 0;

    if (currentBalance <= 0) {
      return res.status(400).json({ error: 'No outstanding advance to deposit' });
    }

    if (amount > currentBalance) {
      return res.status(400).json({ error: 'Deposit amount exceeds advance balance' });
    }

    const newBalance = currentBalance - amount;

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

// Find or add the POST route for saving bonus deposits
router.post('/bonus/:id/deposit', async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, extraBonus } = req.body; // Accept extraBonus as well

    // Dynamic import: if Bonus model is not present, return a clear error (won't crash on import)
    let Bonus;
    try {
      const mod = await import('../models/Bonus.js');
      Bonus = mod.default || mod.Bonus || mod;
    } catch (e) {
      return res.status(501).json({ error: 'Bonus model not available on server', details: e.message });
    }

    const bonusRecord = await Bonus.findById(id);
    if (!bonusRecord) {
      return res.status(404).json({ error: 'Bonus record not found' });
    }

    // Update extraBonus if provided
    if (extraBonus !== undefined && extraBonus !== null) {
      bonusRecord.extraBonus = extraBonus;
    }

    // Add to existing deposit if amount provided
    if (amount && amount > 0) {
      bonusRecord.deposit = (bonusRecord.deposit || 0) + amount;

      // Add transaction record
      bonusRecord.transactions = bonusRecord.transactions || [];
      bonusRecord.transactions.push({
        type: 'bonus-deposit',
        amount,
        date: new Date(),
        note: 'Deposit from bonus'
      });
    }

    // Recalculate Final Amount: Base - Penalty + ExtraBonus - Deposit
    // (DO NOT include currentAdvance as per your request)
    bonusRecord.finalAmount =
      (bonusRecord.baseBonus || 0) -
      (bonusRecord.penalty || 0) +
      (bonusRecord.extraBonus || 0) -
      (bonusRecord.deposit || 0);

    await bonusRecord.save();

    res.json({ success: true, bonusRecord });
  } catch (error) {
    console.error('Deposit save error:', error);
    res.status(500).json({ error: 'Failed to save deposit', details: error.message });
  }
});

// Update bonus record (for extraBonus and other fields)
router.put('/bonus/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { baseBonus, penalty, extraBonus, deposit } = req.body;

    // Dynamic import
    let Bonus;
    try {
      const mod = await import('../models/Bonus.js');
      Bonus = mod.default || mod.Bonus || mod;
    } catch (e) {
      return res.status(501).json({ error: 'Bonus model not available on server', details: e.message });
    }

    const bonusRecord = await Bonus.findById(id);
    if (!bonusRecord) {
      return res.status(404).json({ error: 'Bonus record not found' });
    }

    // Update fields if provided
    if (baseBonus !== undefined) bonusRecord.baseBonus = baseBonus;
    if (penalty !== undefined) bonusRecord.penalty = penalty;
    if (extraBonus !== undefined) bonusRecord.extraBonus = extraBonus;
    if (deposit !== undefined) bonusRecord.deposit = deposit;

    // Recalculate Final Amount: Base - Penalty + ExtraBonus - Deposit
    bonusRecord.finalAmount =
      (bonusRecord.baseBonus || 0) -
      (bonusRecord.penalty || 0) +
      (bonusRecord.extraBonus || 0) -
      (bonusRecord.deposit || 0);

    await bonusRecord.save();

    res.json({ success: true, bonusRecord });
  } catch (error) {
    console.error('Bonus update error:', error);
    res.status(500).json({ error: 'Failed to update bonus', details: error.message });
  }
});

// Save bonus with deposit (like salary deposit - subtract from total)
router.post('/bonus/:id/save', async (req, res) => {
  try {
    const { id } = req.params;
    const { deposit, extraBonus } = req.body;

    // Dynamic import
    let Bonus;
    try {
      const mod = await import('../models/Bonus.js');
      Bonus = mod.default || mod.Bonus || mod;
    } catch (e) {
      return res.status(501).json({ error: 'Bonus model not available on server', details: e.message });
    }

    const bonusRecord = await Bonus.findById(id);
    if (!bonusRecord) {
      return res.status(404).json({ error: 'Bonus record not found' });
    }

    const oldDeposit = bonusRecord.deposit || 0;
    const oldExtraBonus = bonusRecord.extraBonus || 0;

    // Update extraBonus if provided
    if (extraBonus !== undefined && extraBonus !== null) {
      bonusRecord.extraBonus = extraBonus;
    }

    // Update deposit if provided (this replaces the total deposit, not adds to it)
    if (deposit !== undefined && deposit !== null) {
      const depositDiff = deposit - oldDeposit;
      bonusRecord.deposit = deposit;

      // Add transaction if deposit changed
      if (depositDiff !== 0) {
        bonusRecord.transactions = bonusRecord.transactions || [];
        bonusRecord.transactions.push({
          type: depositDiff > 0 ? 'bonus-deposit' : 'bonus-refund',
          amount: Math.abs(depositDiff),
          date: new Date(),
          note: depositDiff > 0 ? 'Deposit added' : 'Deposit reduced'
        });
      }
    }

    // Recalculate Final Amount: Base - Penalty + ExtraBonus - Deposit
    bonusRecord.finalAmount =
      (bonusRecord.baseBonus || 0) -
      (bonusRecord.penalty || 0) +
      (bonusRecord.extraBonus || 0) -
      (bonusRecord.deposit || 0);

    await bonusRecord.save();

    res.json({ 
      success: true, 
      bonusRecord,
      message: `Saved. Final Amount: ${bonusRecord.finalAmount}`
    });
  } catch (error) {
    console.error('Bonus save error:', error);
    res.status(500).json({ error: 'Failed to save bonus', details: error.message });
  }
});

// Export Active Workers Dues Chart - Like the physical ledger in the image
// Format: S.No | Name | Advance (initial) | AD/DP columns for each transaction | Balance
router.get('/export/active', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    if (end < start) {
      return res.status(400).json({ error: 'endDate must be after startDate' });
    }

    // Get all workers with advances
    const workers = await Worker.find({
      $or: [
        { advanceBalance: { $gt: 0 } },
        { totalAdvanceTaken: { $gt: 0 } }
      ]
    }).select('name workerId advanceBalance hourlyRate')
      .sort({ name: 1 });

    // Get all advances in date range
    const advances = await Advance.find({
      date: { $gte: start, $lte: end }
    }).populate('worker', 'name workerId')
      .sort({ date: 1 });

    // Group advances by worker
    const workerAdvancesMap = new Map();
    workers.forEach(w => {
      workerAdvancesMap.set(w._id.toString(), {
        worker: w,
        transactions: []
      });
    });

    advances.forEach(adv => {
      const wId = adv.worker?._id?.toString();
      if (wId && workerAdvancesMap.has(wId)) {
        workerAdvancesMap.get(wId).transactions.push(adv);
      }
    });

    // Compute per-worker advance/deposit lists and max pairs (ADn/DPn)
    let maxPairs = 0;
    workerAdvancesMap.forEach(data => {
      const advList = data.transactions.filter(t => t.type === 'advance').map(t => t.amount || 0);
      const depList = data.transactions.filter(t => t.type === 'deposit' || t.type === 'repayment').map(t => t.amount || 0);
      data.advList = advList;
      data.depList = depList;
      data.totalAdvance = advList.reduce((s, v) => s + v, 0);
      data.totalDeposit = depList.reduce((s, v) => s + v, 0);
      if (Math.max(advList.length, depList.length) > maxPairs) {
        maxPairs = Math.max(advList.length, depList.length);
      }
    });
 
    // Build Excel workbook (headers include AD1/DP1, AD2/DP2 ... up to maxPairs)
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Labour Dues Chart');
 
    // Title
    const titleText = `Labour Dues Chart ${start.getFullYear()}-${end.getFullYear()} (${start.toLocaleDateString('en-IN')})`;
    worksheet.mergeCells(1, 1, 1, 3 + (maxPairs * 2) + 1); // S.No, Name, Advance + (ADn/DPn pairs) + Balance
    worksheet.getCell('A1').value = titleText;
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };
 
    worksheet.addRow([]);
 
    // Build headers: S.No | Name | Advance | AD1 | DP1 | AD2 | DP2 ... | Balance
    const headers = ['S.No', 'Name', 'Advance'];
    for (let i = 1; i <= maxPairs; i++) {
      headers.push(`AD${i}`);
      headers.push(`DP${i}`);
    }
    headers.push('Balance');
 
    const headerRow = worksheet.addRow(headers);
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
      cell.alignment = { horizontal: 'center' };
    });
 
    // Data rows - one row per worker
    let sNo = 1;
    workerAdvancesMap.forEach((data) => {
      const { worker, transactions, advList, depList, totalAdvance, totalDeposit } = data;
      // Calculate initial advance (first advance or total advances)
      const advanceTransactions = transactions.filter(t => t.type === 'advance');
      const depositTransactions = transactions.filter(t => t.type === 'deposit' || t.type === 'repayment');

      const initialAdvance = advanceTransactions.length > 0 ? advanceTransactions[0].amount : 0;

      // Build row data
      const rowData = [
        sNo,
        worker.name,
        initialAdvance > 0 ? initialAdvance : ''
      ];

      // Add AD/DP columns for each transaction (skip first advance as it's in Advance column)
      for (let i = 0; i < maxPairs; i++) {
        rowData.push(advList[i] ?? '');
        rowData.push(depList[i] ?? '');
      }

      // Balance = totalAdvance - totalDeposit
      const balance = (totalAdvance || 0) - (totalDeposit || 0);
      rowData.push(balance);

      const row = worksheet.addRow(rowData);

      // Style cells
      row.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        cell.alignment = { horizontal: 'center' };

        // Color ADn/DPn columns: AD columns are at indices 4,6,8..., DP columns 5,7,9...
        const adStartCol = 4; // A:1, S.No:1, Name:2, Advance:3 => AD1 at col 4
        if (maxPairs > 0 && colNumber >= adStartCol && colNumber < adStartCol + maxPairs * 2) {
          const offset = colNumber - adStartCol;
          if (offset % 2 === 0) {
            // AD column
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFFCDD2' } // Light red for AD
            };
          } else {
            // DP column
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFFF9C4' } // Light yellow for DP
            };
          }
        }
      });

      sNo++;
    });

    // Column widths
    const colWidths = [{ width: 6 }, { width: 20 }, { width: 12 }];
    for (let i = 0; i < maxPairs; i++) {
      colWidths.push({ width: 10 }, { width: 10 }); // ADn, DPn
    }
    colWidths.push({ width: 12 });
    worksheet.columns = colWidths;

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const filename = `labour_dues_chart_${start.toISOString().split('T')[0]}_to_${end.toISOString().split('T')[0]}.xlsx`;

    res.json({ base64, filename });
  } catch (error) {
    console.error('Export active error:', error);
    res.status(500).json({ error: 'Failed to export active advances', details: error.message });
  }
});

// Export Overall - Simple summary: one row per worker with Advance, Deposit, Dues Left
router.get('/export/overall', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const filter = {};
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) {
        const e = new Date(endDate);
        e.setHours(23, 59, 59, 999);
        filter.date.$lte = e;
      }
    }

    // Get all advances
    const advances = await Advance.find(filter)
      .populate('worker', 'name workerId advanceBalance')
      .sort({ date: -1 });

    // Aggregate by worker: total advance, total deposit, dues left
    const workerSummary = new Map();
    advances.forEach(adv => {
      const wId = adv.worker?._id?.toString() || 'unknown';
      const existing = workerSummary.get(wId) || {
        name: adv.worker?.name || '',
        workerId: adv.worker?.workerId || '',
        totalAdvance: 0,
        totalDeposit: 0
      };

      if (adv.type === 'advance') {
        existing.totalAdvance += adv.amount || 0;
      } else if (adv.type === 'deposit' || adv.type === 'repayment') {
        existing.totalDeposit += adv.amount || 0;
      }

      workerSummary.set(wId, existing);
    });

    // Build Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Overall Summary');

    // Title
    const startStr = startDate ? new Date(startDate).toLocaleDateString('en-IN') : 'Beginning';
    const endStr = endDate ? new Date(endDate).toLocaleDateString('en-IN') : 'Present';
    worksheet.mergeCells('A1:E1');
    worksheet.getCell('A1').value = `Advance Summary (${startStr} to ${endStr})`;
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.addRow([]);

    // Headers: S.No | Name | Advance | Deposit | Dues Left
    const headerRow = worksheet.addRow(['S.No', 'Name', 'Advance', 'Deposit', 'Dues Left']);
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
      cell.alignment = { horizontal: 'center' };
    });

    // Data rows
    let sNo = 1;
    let totalAdv = 0, totalDep = 0, totalDues = 0;

    Array.from(workerSummary.values()).forEach((summary) => {
      const duesLeft = summary.totalAdvance - summary.totalDeposit;
      
      const row = worksheet.addRow([
        sNo,
        summary.name,
        summary.totalAdvance,
        summary.totalDeposit,
        duesLeft
      ]);

      totalAdv += summary.totalAdvance;
      totalDep += summary.totalDeposit;
      totalDues += duesLeft;

      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        cell.alignment = { horizontal: 'center' };
      });

      sNo++;
    });

    // Totals row
    const totalsRow = worksheet.addRow(['', 'TOTAL', totalAdv, totalDep, totalDues]);
    totalsRow.font = { bold: true };
    totalsRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFD700' }
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cell.alignment = { horizontal: 'center' };
    });

    // Column widths
    worksheet.columns = [
      { width: 8 },
      { width: 25 },
      { width: 15 },
      { width: 15 },
      { width: 15 }
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const filename = `advance_summary_${startStr.replace(/\//g, '-')}_to_${endStr.replace(/\//g, '-')}.xlsx`;

    res.json({ base64, filename });
  } catch (error) {
    console.error('Export overall error:', error);
    res.status(500).json({ error: 'Failed to export overall summary', details: error.message });
  }
});

export default router;
