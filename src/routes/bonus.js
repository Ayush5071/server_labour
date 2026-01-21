import express from 'express';
import ExcelJS from 'exceljs';
import Bonus from '../models/Bonus.js';
import Worker from '../models/Worker.js';
import DailyEntry from '../models/DailyEntry.js';
import Advance from '../models/Advance.js';

const router = express.Router();

const months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Get all bonuses for a year
router.get('/:year', async (req, res) => {
  try {
    const bonuses = await Bonus.find({ year: parseInt(req.params.year) })
      .populate('worker', 'name workerId hourlyRate advanceBalance')
      .sort({ 'worker.name': 1 });

    res.json(bonuses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get bonuses by date range
router.get('/date-range', async (req, res) => {
  try {
    const { startYear, startMonth, endYear, endMonth } = req.query;
    
    const startDate = new Date(startYear, startMonth - 1, 1);
    const endDate = new Date(endYear, endMonth, 0, 23, 59, 59, 999);
    
    const bonuses = await Bonus.find({
      periodStart: { $gte: startDate },
      periodEnd: { $lte: endDate }
    })
      .populate('worker', 'name workerId hourlyRate advanceBalance')
      .sort({ 'worker.name': 1 });

    res.json(bonuses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Calculate bonus for all workers
router.post('/calculate', async (req, res) => {
  try {
    const { year, baseAmount, penaltyPerAbsent, deductAdvance } = req.body;

    const workers = await Worker.find({ isActive: true });
    const results = [];

    // Get date range for the year
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);

    for (const worker of workers) {
      // Get attendance stats for the year
      const entries = await DailyEntry.find({
        worker: worker._id,
        date: { $gte: yearStart, $lte: yearEnd }
      });

      const totalDaysWorked = entries.filter(e => 
        e.status === 'present' || e.status === 'holiday'
      ).length;
      const totalDaysAbsent = entries.filter(e => e.status === 'absent').length;

      // Calculate penalties
      const absentPenalty = totalDaysAbsent * (penaltyPerAbsent || 0);
      const advanceDeduction = deductAdvance ? worker.advanceBalance : 0;
      const finalAmount = Math.max(0, baseAmount - absentPenalty - advanceDeduction);

      // Upsert bonus record
      const bonus = await Bonus.findOneAndUpdate(
        { year, worker: worker._id },
        {
          year,
          worker: worker._id,
          baseBonusAmount: baseAmount,
          totalDaysWorked,
          totalDaysAbsent,
          absentPenaltyPerDay: penaltyPerAbsent || 0,
          totalPenalty: absentPenalty,
          advanceDeduction,
          finalBonusAmount: finalAmount
        },
        { upsert: true, new: true }
      );

      results.push(bonus);
    }

    const populatedResults = await Bonus.find({ year })
      .populate('worker', 'name workerId hourlyRate advanceBalance')
      .sort({ 'worker.name': 1 });

    res.json(populatedResults);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Mark bonus as paid
router.post('/pay/:id', async (req, res) => {
  try {
    const { amountPaid } = req.body;
    const bonus = await Bonus.findById(req.params.id);

    if (!bonus) {
      return res.status(404).json({ error: 'Bonus not found' });
    }

    // If advance was deducted, update worker's advance balance
    if (bonus.advanceDeduction > 0 && !bonus.isPaid) {
      const worker = await Worker.findById(bonus.worker);
      const newBalance = Math.max(0, worker.advanceBalance - bonus.advanceDeduction);

      await Advance.create({
        worker: bonus.worker,
        type: 'repayment',
        amount: bonus.advanceDeduction,
        date: new Date(),
        notes: `Deducted from ${bonus.year} bonus`,
        balanceAfter: newBalance
      });

      await Worker.findByIdAndUpdate(bonus.worker, {
        advanceBalance: newBalance,
        $inc: { totalAdvanceRepaid: bonus.advanceDeduction }
      });
    }

    const updatedBonus = await Bonus.findByIdAndUpdate(
      req.params.id,
      {
        amountPaid: amountPaid || bonus.finalBonusAmount,
        isPaid: true,
        paidDate: new Date()
      },
      { new: true }
    ).populate('worker', 'name workerId');

    res.json(updatedBonus);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get bonus summary for a year
router.get('/summary/:year', async (req, res) => {
  try {
    const bonuses = await Bonus.find({ year: parseInt(req.params.year) })
      .populate('worker', 'name workerId hourlyRate advanceBalance');

    const summary = {
      year: parseInt(req.params.year),
      totalWorkers: bonuses.length,
      totalBonusAmount: bonuses.reduce((sum, b) => sum + b.finalBonusAmount, 0),
      totalBonusPaid: bonuses.filter(b => b.isPaid).reduce((sum, b) => sum + b.amountPaid, 0),
      totalBonusPending: bonuses.filter(b => !b.isPaid).reduce((sum, b) => sum + b.finalBonusAmount, 0),
      workersPaid: bonuses.filter(b => b.isPaid).length,
      workersPending: bonuses.filter(b => !b.isPaid).length
    };

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Calculate bonus by date range
router.post('/calculate-date-range', async (req, res) => {
  try {
    const { startYear, startMonth, endYear, endMonth, baseAmount, penaltyPerAbsent, deductAdvance } = req.body;

    const workers = await Worker.find({ isActive: true });
    const results = [];

    const periodStart = new Date(startYear, startMonth - 1, 1);
    const periodEnd = new Date(endYear, endMonth, 0, 23, 59, 59, 999);

    for (const worker of workers) {
      const entries = await DailyEntry.find({
        worker: worker._id,
        date: { $gte: periodStart, $lte: periodEnd }
      });

      const totalDaysWorked = entries.filter(e => 
        e.status === 'present' || e.status === 'holiday'
      ).length;
      const totalDaysAbsent = entries.filter(e => e.status === 'absent').length;

      const absentPenalty = totalDaysAbsent * (penaltyPerAbsent || 0);
      const advanceDeduction = deductAdvance ? worker.advanceBalance : 0;
      const finalAmount = Math.max(0, baseAmount - absentPenalty - advanceDeduction);

      const bonus = await Bonus.findOneAndUpdate(
        { 
          worker: worker._id,
          periodStart,
          periodEnd
        },
        {
          year: endYear,
          worker: worker._id,
          periodStart,
          periodEnd,
          baseBonusAmount: baseAmount,
          totalDaysWorked,
          totalDaysAbsent,
          absentPenaltyPerDay: penaltyPerAbsent || 0,
          totalPenalty: absentPenalty,
          advanceDeduction,
          finalBonusAmount: finalAmount
        },
        { upsert: true, new: true }
      );

      results.push(bonus);
    }

    const populatedResults = await Bonus.find({
      periodStart,
      periodEnd
    })
      .populate('worker', 'name workerId hourlyRate advanceBalance')
      .sort({ 'worker.name': 1 });

    res.json(populatedResults);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update bonus
router.put('/:id', async (req, res) => {
  try {
    const { finalBonusAmount, advanceDeduction } = req.body;
    
    const bonus = await Bonus.findByIdAndUpdate(
      req.params.id,
      { finalBonusAmount, advanceDeduction },
      { new: true }
    ).populate('worker', 'name workerId advanceBalance');

    res.json(bonus);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get summary by date range
router.get('/summary-date-range', async (req, res) => {
  try {
    const { startYear, startMonth, endYear, endMonth } = req.query;
    
    const periodStart = new Date(startYear, startMonth - 1, 1);
    const periodEnd = new Date(endYear, endMonth, 0, 23, 59, 59, 999);
    
    const bonuses = await Bonus.find({
      periodStart: { $gte: periodStart },
      periodEnd: { $lte: periodEnd }
    }).populate('worker', 'name workerId hourlyRate advanceBalance');

    const summary = {
      startYear: parseInt(startYear),
      startMonth: parseInt(startMonth),
      endYear: parseInt(endYear),
      endMonth: parseInt(endMonth),
      totalWorkers: bonuses.length,
      totalBonusAmount: bonuses.reduce((sum, b) => sum + b.finalBonusAmount, 0),
      totalBonusPaid: bonuses.filter(b => b.isPaid).reduce((sum, b) => sum + b.amountPaid, 0),
      totalBonusPending: bonuses.filter(b => !b.isPaid).reduce((sum, b) => sum + b.finalBonusAmount, 0),
      workersPaid: bonuses.filter(b => b.isPaid).length,
      workersPending: bonuses.filter(b => !b.isPaid).length
    };

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export bonus to Excel
router.get('/export/excel', async (req, res) => {
  try {
    const { startYear, startMonth, endYear, endMonth } = req.query;
    
    const periodStart = new Date(startYear, startMonth - 1, 1);
    const periodEnd = new Date(endYear, endMonth, 0, 23, 59, 59, 999);
    
    const bonuses = await Bonus.find({
      periodStart: { $gte: periodStart },
      periodEnd: { $lte: periodEnd }
    }).populate('worker', 'name workerId hourlyRate advanceBalance bankDetails');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Worker Management System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Bonus Payment');

    // Title
    worksheet.mergeCells('A1:H1');
    worksheet.getCell('A1').value = `Bonus Payment (${months[startMonth - 1]} ${startYear} - ${months[endMonth - 1]} ${endYear})`;
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.addRow([]);
    
    // Headers
    const headerRow = worksheet.addRow([
      'S.No',
      'Worker ID',
      'Worker Name',
      'Base Amount',
      'Advance Taken',
      'Deduction',
      'Final Amount',
      'Status'
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

    // Data rows
    let totalFinal = 0;
    bonuses.forEach((bonus, index) => {
      const row = worksheet.addRow([
        index + 1,
        bonus.worker?.workerId || '',
        bonus.worker?.name || '',
        bonus.baseBonusAmount,
        bonus.worker?.advanceBalance || 0,
        bonus.advanceDeduction,
        bonus.finalBonusAmount,
        bonus.isPaid ? 'Paid' : 'Pending'
      ]);

      totalFinal += bonus.finalBonusAmount;

      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });

    // Total row
    worksheet.addRow([]);
    const totalRow = worksheet.addRow(['', '', '', '', '', 'TOTAL:', totalFinal, '']);
    totalRow.font = { bold: true };

    // Column widths
    worksheet.columns = [
      { width: 8 },
      { width: 15 },
      { width: 25 },
      { width: 15 },
      { width: 15 },
      { width: 15 },
      { width: 15 },
      { width: 12 }
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const filename = `bonus_payment_${startYear}_${startMonth}_to_${endYear}_${endMonth}.xlsx`;

    res.json({ base64, filename });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
