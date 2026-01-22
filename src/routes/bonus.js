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
// Bonus = 30 days × 8 hours × hourly_rate
// Deduction = absent_days × deduction_per_day
// Final = Bonus - Deduction - AdvanceDeduction + ExtraBonus - EmployeeDeposit
router.post('/calculate', async (req, res) => {
  try {
    const { year, deductionPerAbsentDay, deductAdvance } = req.body;

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

      // Calculate base bonus: 30 days × 8 hours × hourly_rate
      const baseBonusAmount = 30 * 8 * (worker.hourlyRate || 0);
      
      // Calculate penalties for absence
      const absentPenalty = totalDaysAbsent * (deductionPerAbsentDay || 0);
      
      // Get existing bonus record to preserve extraBonus and employeeDeposit
      const existingBonus = await Bonus.findOne({ year, worker: worker._id });
      const extraBonus = existingBonus?.extraBonus || 0;
      const employeeDeposit = existingBonus?.employeeDeposit || 0;
      
      // Deduct advance if option is selected
      const advanceDeduction = deductAdvance ? worker.advanceBalance : 0;
      
      // Calculate final amount: base - penalties - advance + extra - deposit
      const finalBonusAmount = Math.max(0, 
        baseBonusAmount - absentPenalty - advanceDeduction + extraBonus
      );
      
      // Amount to give employee: finalBonus - employeeDeposit
      const amountToGiveEmployee = Math.max(0, finalBonusAmount - employeeDeposit);

      // Upsert bonus record
      const bonus = await Bonus.findOneAndUpdate(
        { year, worker: worker._id },
        {
          year,
          worker: worker._id,
          hourlyRate: worker.hourlyRate,
          baseBonusAmount,
          totalDaysWorked,
          totalDaysAbsent,
          absentPenaltyPerDay: deductionPerAbsentDay || 0,
          totalPenalty: absentPenalty,
          advanceDeduction,
          currentAdvanceBalance: worker.advanceBalance,
          extraBonus,
          employeeDeposit,
          finalBonusAmount,
          amountToGiveEmployee
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
        notes: `Deducted from bonus`,
        balanceAfter: newBalance
      });

      await Worker.findByIdAndUpdate(bonus.worker, {
        advanceBalance: newBalance,
        $inc: { totalAdvanceRepaid: bonus.advanceDeduction }
      });
    }

    // If employee deposited money, reduce their advance balance
    if (bonus.employeeDeposit > 0 && !bonus.isPaid) {
      const worker = await Worker.findById(bonus.worker);
      const newBalance = Math.max(0, worker.advanceBalance - bonus.employeeDeposit);

      await Advance.create({
        worker: bonus.worker,
        type: 'deposit',
        amount: bonus.employeeDeposit,
        date: new Date(),
        notes: `Employee deposit towards advance repayment`,
        balanceAfter: newBalance
      });

      await Worker.findByIdAndUpdate(bonus.worker, {
        advanceBalance: newBalance,
        $inc: { totalAdvanceRepaid: bonus.employeeDeposit }
      });
    }

    const updatedBonus = await Bonus.findByIdAndUpdate(
      req.params.id,
      {
        amountPaid: amountPaid || bonus.amountToGiveEmployee,
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
    const { startYear, startMonth, endYear, endMonth, deductionPerAbsentDay, deductAdvance } = req.body;

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

      // Calculate base bonus: 30 days × 8 hours × hourly_rate
      const baseBonusAmount = 30 * 8 * (worker.hourlyRate || 0);
      
      // Calculate penalties for absence
      const absentPenalty = totalDaysAbsent * (deductionPerAbsentDay || 0);
      
      // Get existing bonus record to preserve extraBonus and employeeDeposit
      const existingBonus = await Bonus.findOne({ 
        worker: worker._id,
        periodStart,
        periodEnd
      });
      const extraBonus = existingBonus?.extraBonus || 0;
      const employeeDeposit = existingBonus?.employeeDeposit || 0;
      
      // Deduct advance if option is selected
      const advanceDeduction = deductAdvance ? worker.advanceBalance : 0;
      
      // Calculate final amount: base - penalties - advance + extra - deposit
      const finalBonusAmount = Math.max(0, 
        baseBonusAmount - absentPenalty - advanceDeduction + extraBonus
      );
      
      // Amount to give employee: finalBonus - employeeDeposit
      const amountToGiveEmployee = Math.max(0, finalBonusAmount - employeeDeposit);

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
          hourlyRate: worker.hourlyRate,
          baseBonusAmount,
          totalDaysWorked,
          totalDaysAbsent,
          absentPenaltyPerDay: deductionPerAbsentDay || 0,
          totalPenalty: absentPenalty,
          advanceDeduction,
          currentAdvanceBalance: worker.advanceBalance,
          extraBonus,
          employeeDeposit,
          finalBonusAmount,
          amountToGiveEmployee
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

// Add extra bonus to a worker's bonus
router.post('/add-extra-bonus/:bonusId', async (req, res) => {
  try {
    const { extraAmount, notes } = req.body;
    
    if (!extraAmount || extraAmount <= 0) {
      return res.status(400).json({ error: 'Extra bonus amount must be greater than 0' });
    }

    const bonus = await Bonus.findById(req.params.bonusId);
    if (!bonus) {
      return res.status(404).json({ error: 'Bonus not found' });
    }

    // Update extra bonus and recalculate final amounts
    const newExtraBonus = (bonus.extraBonus || 0) + extraAmount;
    const newFinalBonusAmount = Math.max(0, 
      bonus.baseBonusAmount - bonus.totalPenalty - bonus.advanceDeduction + newExtraBonus
    );
    const newAmountToGiveEmployee = Math.max(0, newFinalBonusAmount - bonus.employeeDeposit);

    const updatedBonus = await Bonus.findByIdAndUpdate(
      req.params.bonusId,
      {
        extraBonus: newExtraBonus,
        finalBonusAmount: newFinalBonusAmount,
        amountToGiveEmployee: newAmountToGiveEmployee,
        notes: (bonus.notes ? bonus.notes + '\n' : '') + (notes || `Added ₹${extraAmount} extra bonus`)
      },
      { new: true }
    ).populate('worker', 'name workerId hourlyRate advanceBalance');

    res.json(updatedBonus);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Employee deposit towards advance repayment (deducted from bonus)
router.post('/add-employee-deposit/:bonusId', async (req, res) => {
  try {
    const { depositAmount, notes } = req.body;
    
    if (!depositAmount || depositAmount <= 0) {
      return res.status(400).json({ error: 'Deposit amount must be greater than 0' });
    }

    const bonus = await Bonus.findById(req.params.bonusId);
    if (!bonus) {
      return res.status(404).json({ error: 'Bonus not found' });
    }

    // Check if deposit doesn't exceed final bonus amount
    if (depositAmount > bonus.finalBonusAmount) {
      return res.status(400).json({ 
        error: `Deposit amount (₹${depositAmount}) cannot exceed final bonus (₹${bonus.finalBonusAmount})` 
      });
    }

    // Update employee deposit and recalculate amount to give
    const newEmployeeDeposit = (bonus.employeeDeposit || 0) + depositAmount;
    const newAmountToGiveEmployee = Math.max(0, bonus.finalBonusAmount - newEmployeeDeposit);

    const updatedBonus = await Bonus.findByIdAndUpdate(
      req.params.bonusId,
      {
        employeeDeposit: newEmployeeDeposit,
        amountToGiveEmployee: newAmountToGiveEmployee,
        notes: (bonus.notes ? bonus.notes + '\n' : '') + (notes || `Employee deposited ₹${depositAmount}`)
      },
      { new: true }
    ).populate('worker', 'name workerId hourlyRate advanceBalance');

    res.json(updatedBonus);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get bonus summary by date range

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
    worksheet.mergeCells('A1:L1');
    worksheet.getCell('A1').value = `Bonus Payment (${months[startMonth - 1]} ${startYear} - ${months[endMonth - 1]} ${endYear})`;
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    // Formula explanation
    worksheet.mergeCells('A2:L2');
    worksheet.getCell('A2').value = 'Formula: Base Bonus = 30 days × 8 hours × Hourly Rate';
    worksheet.getCell('A2').font = { italic: true, size: 10 };
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    worksheet.addRow([]);
    
    // Headers
    const headerRow = worksheet.addRow([
      'S.No',
      'Worker ID',
      'Worker Name',
      'Hourly Rate',
      'Base Bonus',
      'Absent Days',
      'Penalty',
      'Advance Deducted',
      'Extra Bonus',
      'Employee Deposit',
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
    let totalDeposit = 0;
    bonuses.forEach((bonus, index) => {
      const amountToGive = bonus.amountToGiveEmployee || bonus.finalBonusAmount;
      const row = worksheet.addRow([
        index + 1,
        bonus.worker?.workerId || '',
        bonus.worker?.name || '',
        bonus.hourlyRate || bonus.worker?.hourlyRate || 0,
        bonus.baseBonusAmount,
        bonus.totalDaysAbsent,
        bonus.totalPenalty,
        bonus.advanceDeduction,
        bonus.extraBonus || 0,
        bonus.employeeDeposit || 0,
        amountToGive,
        bonus.isPaid ? 'Paid' : 'Pending'
      ]);

      totalFinal += amountToGive;
      totalDeposit += bonus.employeeDeposit || 0;

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
    const totalRow = worksheet.addRow(['', '', '', '', '', '', '', '', '', 'TOTAL:', totalFinal, '']);
    totalRow.font = { bold: true };

    // Column widths
    worksheet.columns = [
      { width: 8 },
      { width: 12 },
      { width: 20 },
      { width: 10 },
      { width: 12 },
      { width: 10 },
      { width: 10 },
      { width: 14 },
      { width: 12 },
      { width: 14 },
      { width: 14 },
      { width: 10 }
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
