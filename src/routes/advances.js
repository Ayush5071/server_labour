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

// Export Active Workers Dues Chart - Like the physical ledger in the image
// Format: S.No | Name | Advance (initial) | AD/DP columns for each transaction | Balance
router.get('/export/active', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Get active workers who have advances
    const workers = await Worker.find({ 
      isActive: true,
      $or: [
        { advanceBalance: { $gt: 0 } },
        { totalAdvanceTaken: { $gt: 0 } }
      ]
    })
      .select('name workerId advanceBalance totalAdvanceTaken totalAdvanceRepaid')
      .sort({ name: 1 });

    // Get all advances for these workers
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

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Worker Management System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Labour Dues Chart');

    // Format dates for title
    const startDateStr = startDate ? new Date(startDate).toLocaleDateString('en-IN') : 'Beginning';
    const endDateStr = endDate ? new Date(endDate).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN');

    // Title
    worksheet.mergeCells('A1:Z1');
    worksheet.getCell('A1').value = `Labour Dues Chart 2024-2025 (${endDateStr})`;
    worksheet.getCell('A1').font = { bold: true, size: 14 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.addRow([]);

    // Build header row dynamically based on actual transactions in the selected range
    // Fetch advances for these workers inside the date filter and group by worker
    const workerIds = workers.map(w => w._id);
    const allAdvances = await Advance.find({
      worker: { $in: workerIds },
      ...(filter.date && { date: filter.date })
    }).sort({ date: 1 });

    const advancesByWorker = {};
    allAdvances.forEach(a => {
      const id = a.worker.toString();
      advancesByWorker[id] = advancesByWorker[id] || [];
      advancesByWorker[id].push(a);
    });

    // Helper to compute number of AD/DP pairs that will be produced for a worker
    const computePairsCount = (transactions) => {
      let pairs = 0;
      let currentAd = null;
      let currentDp = null;
      transactions.forEach((t, idx) => {
        if (t.type === 'advance') {
          if (idx === 0 && pairs === 0) {
            // first advance goes to Advance column, not a pair
            // leave as-is
          } else {
            if (currentAd !== null || currentDp !== null) {
              pairs++;
              currentAd = null;
              currentDp = null;
            }
            currentAd = t.amount;
          }
        } else {
          currentDp = t.amount;
          if (currentAd !== null || currentDp !== null) {
            pairs++;
            currentAd = null;
            currentDp = null;
          }
        }
      });
      if (currentAd !== null || currentDp !== null) pairs++;
      return pairs;
    };

    // Determine max pairs needed across workers (cap to reasonable limit to avoid huge spreadsheets)
    const pairsCounts = Object.values(advancesByWorker).map(tx => computePairsCount(tx));
    const maxPairs = Math.min(20, pairsCounts.length ? Math.max(...pairsCounts) : 0);

    const headers = ['Sl.No.', 'NAME', 'Advance'];
    for (let i = 0; i < maxPairs; i++) {
      headers.push('AD');
      headers.push('DP');
    }
    headers.push('Balance');

    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true, size: 9 };
    headerRow.eachCell((cell, colNumber) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: colNumber <= 3 || colNumber === headers.length ? 'FF4472C4' : 'FFFFC000' } // Blue for first cols and balance, Yellow for AD/DP
      };
      cell.font = { bold: true, size: 9, color: { argb: colNumber <= 3 || colNumber === headers.length ? 'FFFFFFFF' : 'FF000000' } };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // Data rows for each worker
    for (let wIndex = 0; wIndex < workers.length; wIndex++) {
      const worker = workers[wIndex];
      
      // Reuse pre-fetched transactions grouped by worker (if any)
      const transactions = (advancesByWorker[worker._id.toString()] || []);

      // Build row data
      const rowData = [wIndex + 1, worker.name, '']; // S.No, Name, Advance (filled if first transaction is advance)
      
      // Separate advances (AD) and deposits (DP) chronologically
      let initialAdvance = 0;
      const adDpPairs = [];
      let currentAd = '';
      let currentDp = '';
      
      transactions.forEach((t, idx) => {
        if (t.type === 'advance') {
          if (idx === 0 && adDpPairs.length === 0) {
            // First transaction is an advance - put in Advance column
            initialAdvance = t.amount;
          } else {
            // Subsequent advance - add as AD
            if (currentAd || currentDp) {
              adDpPairs.push({ ad: currentAd, dp: currentDp });
              currentAd = '';
              currentDp = '';
            }
            currentAd = t.amount;
          }
        } else {
          // Deposit or repayment
          currentDp = t.amount;
          if (currentAd || currentDp) {
            adDpPairs.push({ ad: currentAd, dp: currentDp });
            currentAd = '';
            currentDp = '';
          }
        }
      });
      
      // Push any remaining
      if (currentAd || currentDp) {
        adDpPairs.push({ ad: currentAd, dp: currentDp });
      }

      rowData[2] = initialAdvance || ''; // Advance column
      
      // Fill AD/DP columns
      for (let i = 0; i < maxTransactions; i++) {
        if (i < adDpPairs.length) {
          rowData.push(adDpPairs[i].ad || '');
          rowData.push(adDpPairs[i].dp || '');
        } else {
          rowData.push('');
          rowData.push('');
        }
      }
      
      // Balance at the end
      rowData.push(worker.advanceBalance);

      const dataRow = worksheet.addRow(rowData);
      
      // Style the row
      dataRow.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        cell.alignment = { horizontal: colNumber <= 2 ? 'left' : 'center', vertical: 'middle' };
        cell.font = { size: 9 };

        // Color coding
        if (colNumber === 3 && cell.value) {
          // Initial advance - light red
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCCCC' } };
        } else if (colNumber > 3 && colNumber < headers.length) {
          const isAdColumn = (colNumber - 4) % 2 === 0;
          if (cell.value) {
            if (isAdColumn) {
              // AD column with value - light red
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCCCC' } };
            } else {
              // DP column with value - light green
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8E6C9' } };
            }
          }
        } else if (colNumber === headers.length) {
          // Balance column - yellow background
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } };
          cell.font = { bold: true, size: 9 };
        }
      });
    }

    // Set column widths
    worksheet.getColumn(1).width = 6;  // S.No
    worksheet.getColumn(2).width = 15; // Name
    worksheet.getColumn(3).width = 10; // Advance
    for (let i = 4; i <= 3 + maxTransactions * 2; i++) {
      worksheet.getColumn(i).width = 6; // AD/DP columns
    }
    worksheet.getColumn(headers.length).width = 10; // Balance

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const filename = `labour_dues_active_${endDateStr.replace(/\//g, '-')}.xlsx`;

    res.json({ base64, filename });
  } catch (error) {
    console.error('Export active error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export Overall - All workers who ever took advance with summary
router.get('/export/overall', async (req, res) => {
  try {
    // Get all workers who have ever taken advance
    const workers = await Worker.find({
      $or: [
        { advanceBalance: { $gt: 0 } },
        { totalAdvanceTaken: { $gt: 0 } }
      ]
    })
      .select('name workerId advanceBalance totalAdvanceTaken totalAdvanceRepaid isActive')
      .sort({ name: 1 });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Worker Management System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Overall Dues Summary');

    const dateStr = new Date().toLocaleDateString('en-IN');

    // Title
    worksheet.mergeCells('A1:G1');
    worksheet.getCell('A1').value = `Overall Labour Dues Summary (${dateStr})`;
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.addRow([]);

    // Headers
    const headerRow = worksheet.addRow([
      'S.No',
      'Worker ID',
      'Worker Name',
      'Status',
      'Total Advance Taken',
      'Total Repaid/Deposited',
      'Current Balance'
    ]);

    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cell.alignment = { horizontal: 'center' };
    });

    let totalAdvanceTaken = 0;
    let totalRepaid = 0;
    let totalBalance = 0;

    workers.forEach((worker, index) => {
      const row = worksheet.addRow([
        index + 1,
        worker.workerId,
        worker.name,
        worker.isActive ? 'Active' : 'Inactive',
        worker.totalAdvanceTaken || 0,
        worker.totalAdvanceRepaid || 0,
        worker.advanceBalance || 0
      ]);

      totalAdvanceTaken += worker.totalAdvanceTaken || 0;
      totalRepaid += worker.totalAdvanceRepaid || 0;
      totalBalance += worker.advanceBalance || 0;

      row.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };

        // Color the status column
        if (colNumber === 4) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: worker.isActive ? 'FFC8E6C9' : 'FFFFCDD2' }
          };
        }
        
        // Color advance taken (red) and repaid (green)
        if (colNumber === 5 && cell.value > 0) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCCCC' } };
        }
        if (colNumber === 6 && cell.value > 0) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8E6C9' } };
        }
        
        // Color balance yellow if > 0
        if (colNumber === 7 && cell.value > 0) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC000' } };
          cell.font = { bold: true };
        }
      });
    });

    // Total row
    worksheet.addRow([]);
    const totalRow = worksheet.addRow([
      '', '', '', 'TOTAL:',
      totalAdvanceTaken,
      totalRepaid,
      totalBalance
    ]);
    totalRow.font = { bold: true };
    totalRow.eachCell((cell, colNumber) => {
      if (colNumber >= 4) {
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
      }
    });

    // Column widths
    worksheet.columns = [
      { width: 8 },
      { width: 15 },
      { width: 25 },
      { width: 12 },
      { width: 20 },
      { width: 20 },
      { width: 18 }
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const filename = `labour_dues_overall_${dateStr.replace(/\//g, '-')}.xlsx`;

    res.json({ base64, filename });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export dues to Excel with colored cells (legacy)
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
