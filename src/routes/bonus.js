import express from 'express';
import ExcelJS from 'exceljs';
import Bonus from '../models/Bonus.js';
import Worker from '../models/Worker.js';
import DailyEntry from '../models/DailyEntry.js';
import Advance from '../models/Advance.js';
import BonusHistory from '../models/BonusHistory.js';

const router = express.Router();

const months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Get bonuses by date range
router.get('/date-range', async (req, res) => {
  try {
    const { startYear, startMonth, endYear, endMonth } = req.query;

    const sY = parseInt(startYear, 10);
    const sM = parseInt(startMonth, 10);
    const eY = parseInt(endYear, 10);
    const eM = parseInt(endMonth, 10);

    if (Number.isNaN(sY) || Number.isNaN(sM) || Number.isNaN(eY) || Number.isNaN(eM)) {
      return res.status(400).json({ error: 'Invalid or missing startYear/startMonth/endYear/endMonth' });
    }

    if (sM < 1 || sM > 12 || eM < 1 || eM > 12) {
      return res.status(400).json({ error: 'startMonth and endMonth must be between 1 and 12' });
    }

    const startDate = new Date(sY, sM - 1, 1);
    const endDate = new Date(eY, eM, 0, 23, 59, 59, 999);

    if (startDate > endDate) {
      return res.status(400).json({ error: 'Start date must be before or equal to end date' });
    }

    const bonuses = await Bonus.find({
      periodStart: { $gte: startDate },
      periodEnd: { $lte: endDate }
    })
      .populate('worker', 'name workerId hourlyRate advanceBalance')
      .sort({ 'worker.name': 1 });

    res.json(bonuses);
  } catch (error) {
    console.error('GET /bonus/date-range error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Calculate bonus for all workers
// Bonus = 30 days × 8 hours × hourly_rate
// Deduction = absent_days × deduction_per_day
// Final = Bonus - Deduction - AdvanceDeduction + ExtraBonus - EmployeeDeposit
router.post('/calculate', async (req, res) => {
  try {
    const { year, deductionPerAbsentDay, deductAdvance, persist } = req.body;

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
      
      // Do NOT deduct advance here; advance deduction is not part of bonus calculation
      const finalBonusAmount = Math.max(0, baseBonusAmount - absentPenalty + extraBonus);

      // Amount to give employee: finalBonus - employeeDeposit
      const amountToGiveEmployee = Math.max(0, finalBonusAmount - employeeDeposit);

      const bonusPayload = {
        year,
        worker: worker._id,
        hourlyRate: worker.hourlyRate,
        baseBonusAmount,
        totalDaysWorked,
        totalDaysAbsent,
        absentPenaltyPerDay: deductionPerAbsentDay || 0,
        totalPenalty: absentPenalty,
        currentAdvanceBalance: worker.advanceBalance,
        extraBonus,
        employeeDeposit,
        finalBonusAmount,
        amountToGiveEmployee
      };

      if (persist) {
        // Persist to DB only when explicitly requested
        const bonus = await Bonus.findOneAndUpdate(
          { year, worker: worker._id },
          bonusPayload,
          { upsert: true, new: true }
        );
        // populate basic worker info for returned list
        const populated = await Bonus.findById(bonus._id).populate('worker', 'name workerId hourlyRate advanceBalance');
        results.push(populated);
      } else {
        // In-memory result (do not save)
        results.push({ ...bonusPayload, worker: { _id: worker._id, name: worker.name, workerId: worker.workerId, hourlyRate: worker.hourlyRate, advanceBalance: worker.advanceBalance } });
      }
    }

    if (persist) {
      const populatedResults = await Bonus.find({ year }).populate('worker', 'name workerId hourlyRate advanceBalance').sort({ 'worker.name': 1 });
      return res.json(populatedResults);
    }

    res.json(results);
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

    // Do not adjust worker's advance balance when paying bonuses.
    // Bonus payments are separate from advance repayment in this system.

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
// NEW LOGIC: Deduction is relative to the worker with the fewest absents (threshold).
// Workers with min absents get no penalty. Each extra absent above threshold incurs the penalty.
router.post('/calculate-date-range', async (req, res) => {
  try {
    const { startYear, startMonth, endYear, endMonth, persist } = req.body;
    const deductionPerAbsentDay = Number(req.body.deductionPerAbsentDay) || 0;
    const deductAdvance = Boolean(req.body.deductAdvance);

    const sY = parseInt(startYear, 10);
    const sM = parseInt(startMonth, 10);
    const eY = parseInt(endYear, 10);
    const eM = parseInt(endMonth, 10);

    if (Number.isNaN(sY) || Number.isNaN(sM) || Number.isNaN(eY) || Number.isNaN(eM)) {
      return res.status(400).json({ error: 'Invalid or missing startYear/startMonth/endYear/endMonth' });
    }

    if (sM < 1 || sM > 12 || eM < 1 || eM > 12) {
      return res.status(400).json({ error: 'startMonth and endMonth must be between 1 and 12' });
    }

    const periodStart = new Date(sY, sM - 1, 1);
    const periodEnd = new Date(eY, eM, 0, 23, 59, 59, 999);

    if (periodStart > periodEnd) {
      return res.status(400).json({ error: 'Start date must be before or equal to end date' });
    }

    const workers = await Worker.find({ isActive: true });

    // STEP 1: Gather attendance data for all workers
    const workerData = [];
    for (const worker of workers) {
      const entries = await DailyEntry.find({
        worker: worker._id,
        date: { $gte: periodStart, $lte: periodEnd }
      });

      const totalDaysWorked = entries.filter(e => 
        e.status === 'present' || e.status === 'holiday'
      ).length;
      const totalDaysAbsent = entries.filter(e => e.status === 'absent').length;

      workerData.push({
        worker,
        totalDaysWorked,
        totalDaysAbsent
      });
    }

    // STEP 2: Determine threshold (minimum absent days among workers)
    const minAbsent = workerData.length > 0 ? Math.min(...workerData.map(w => w.totalDaysAbsent)) : 0;

    // STEP 3: Calculate bonus for each worker
    const results = [];
    for (const { worker, totalDaysWorked, totalDaysAbsent } of workerData) {
      // Calculate base bonus: 30 days × 8 hours × hourly_rate
      const baseBonusAmount = 30 * 8 * (worker.hourlyRate || 0);

      // Penalty: only extra absents above the minimum threshold incur penalty
      const extraAbsents = Math.max(0, totalDaysAbsent - minAbsent);
      const absentPenalty = extraAbsents * deductionPerAbsentDay;

      // Get existing bonus record to preserve extraBonus and employeeDeposit
      const existingBonus = await Bonus.findOne({ 
        worker: worker._id,
        periodStart,
        periodEnd
      });
      const extraBonus = existingBonus?.extraBonus || 0;
      const employeeDeposit = existingBonus?.employeeDeposit || 0;

      // Do NOT deduct advance here; advance deduction is not part of bonus calculation

      // Calculate final amount: base - penalties + extra
      const finalBonusAmount = Math.max(0, 
        baseBonusAmount - absentPenalty + extraBonus
      );

      // Amount to give employee: finalBonus - employeeDeposit
      const amountToGiveEmployee = Math.max(0, finalBonusAmount - employeeDeposit);

      const bonusPayload = {
        year: eY,
        worker: worker._id,
        periodStart,
        periodEnd,
        hourlyRate: worker.hourlyRate,
        baseBonusAmount,
        totalDaysWorked,
        totalDaysAbsent,
        absentPenaltyPerDay: deductionPerAbsentDay,
        totalPenalty: absentPenalty,
        extraBonus,
        employeeDeposit,
        finalBonusAmount,
        amountToGiveEmployee,
        currentAdvanceBalance: worker.advanceBalance
      };

      if (persist) {
        // Persist to DB only when explicitly requested
        const bonus = await Bonus.findOneAndUpdate(
          { 
            year: eY,
            worker: worker._id
          },
          bonusPayload,
          { upsert: true, new: true }
        );
        const populated = await Bonus.findById(bonus._id).populate('worker', 'name workerId hourlyRate advanceBalance');
        results.push(populated);
      } else {
        results.push({ ...bonusPayload, worker: { _id: worker._id, name: worker.name, workerId: worker.workerId, hourlyRate: worker.hourlyRate, advanceBalance: worker.advanceBalance } });
      }
    }

    if (persist) {
      const populatedResults = await Bonus.find({ year: eY })
        .populate('worker', 'name workerId hourlyRate advanceBalance')
        .sort({ 'worker.name': 1 });

      res.json(populatedResults);
      return;
    }

    // Return calculated results without persisting
    res.json(results);
  } catch (error) {
    console.error('POST /bonus/calculate-date-range error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update bonus
router.put('/:id', async (req, res) => {
  try {
    // Only allow updating finalBonusAmount. We no longer use advanceDeduction in calculations.
    const { finalBonusAmount } = req.body;

    const bonus = await Bonus.findById(req.params.id);
    if (!bonus) return res.status(404).json({ error: 'Bonus not found' });

    // Recompute amountToGiveEmployee based on employeeDeposit
    const newFinal = typeof finalBonusAmount === 'number' ? finalBonusAmount : bonus.finalBonusAmount;
    const newAmountToGiveEmployee = Math.max(0, newFinal - (bonus.employeeDeposit || 0));

    bonus.finalBonusAmount = newFinal;
    bonus.amountToGiveEmployee = newAmountToGiveEmployee;
    // Clear any legacy advanceDeduction to avoid confusion
    bonus.advanceDeduction = 0;

    await bonus.save();

    const populated = await Bonus.findById(bonus._id).populate('worker', 'name workerId advanceBalance');
    res.json(populated);
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
      bonus.baseBonusAmount - bonus.totalPenalty + newExtraBonus
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

    const sY = parseInt(startYear, 10);
    const sM = parseInt(startMonth, 10);
    const eY = parseInt(endYear, 10);
    const eM = parseInt(endMonth, 10);

    if (Number.isNaN(sY) || Number.isNaN(sM) || Number.isNaN(eY) || Number.isNaN(eM)) {
      return res.status(400).json({ error: 'Invalid or missing startYear/startMonth/endYear/endMonth' });
    }

    if (sM < 1 || sM > 12 || eM < 1 || eM > 12) {
      return res.status(400).json({ error: 'startMonth and endMonth must be between 1 and 12' });
    }

    const periodStart = new Date(sY, sM - 1, 1);
    const periodEnd = new Date(eY, eM, 0, 23, 59, 59, 999);

    if (periodStart > periodEnd) {
      return res.status(400).json({ error: 'Start date must be before or equal to end date' });
    }

    const bonuses = await Bonus.find({
      periodStart: { $gte: periodStart },
      periodEnd: { $lte: periodEnd }
    }).populate('worker', 'name workerId hourlyRate advanceBalance');

    const summary = {
      startYear: sY,
      startMonth: sM,
      endYear: eY,
      endMonth: eM,
      totalWorkers: bonuses.length,
      totalBonusAmount: bonuses.reduce((sum, b) => sum + b.finalBonusAmount, 0),
      totalBonusPaid: bonuses.filter(b => b.isPaid).reduce((sum, b) => sum + b.amountPaid, 0),
      totalBonusPending: bonuses.filter(b => !b.isPaid).reduce((sum, b) => sum + b.finalBonusAmount, 0),
      workersPaid: bonuses.filter(b => b.isPaid).length,
      workersPending: bonuses.filter(b => !b.isPaid).length
    };

    res.json(summary);
  } catch (error) {
    console.error('GET /bonus/summary-date-range error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export bonus to Excel
router.get('/export/excel', async (req, res) => {
  try {
    const { startYear, startMonth, endYear, endMonth } = req.query;

    const sY = parseInt(startYear, 10);
    const sM = parseInt(startMonth, 10);
    const eY = parseInt(endYear, 10);
    const eM = parseInt(endMonth, 10);

    if (Number.isNaN(sY) || Number.isNaN(sM) || Number.isNaN(eY) || Number.isNaN(eM)) {
      return res.status(400).json({ error: 'Invalid or missing startYear/startMonth/endYear/endMonth' });
    }

    if (sM < 1 || sM > 12 || eM < 1 || eM > 12) {
      return res.status(400).json({ error: 'startMonth and endMonth must be between 1 and 12' });
    }

    const periodStart = new Date(sY, sM - 1, 1);
    const periodEnd = new Date(eY, eM, 0, 23, 59, 59, 999);

    if (periodStart > periodEnd) {
      return res.status(400).json({ error: 'Start date must be before or equal to end date' });
    }

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
    worksheet.getCell('A1').value = `Bonus Payment (${months[sM - 1]} ${sY} - ${months[eM - 1]} ${eY})`;
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    // Formula explanation
    worksheet.mergeCells('A2:L2');
    worksheet.getCell('A2').value = 'Formula: Base Bonus = 30 days × 8 hours × Hourly Rate';
    worksheet.getCell('A2').font = { italic: true, size: 10 };
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    worksheet.addRow([]);
    
    // Headers (removed Status column)
    const headerRow = worksheet.addRow([
      'S.No',
      'Worker ID',
      'Worker Name',
      'Hourly Rate',
      'Base Bonus',
      'Absent Days',
      'Penalty',
      'Current Advance Due',
      'Extra Bonus',
      'Employee Deposit',
      'Final Amount'
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
    let totalAdvanceDue = 0;
    bonuses.forEach((bonus, index) => {
      const amountToGive = bonus.amountToGiveEmployee || bonus.finalBonusAmount;
      const currentAdvanceDue = bonus.worker?.advanceBalance || 0;
      const row = worksheet.addRow([
        index + 1,
        bonus.worker?.workerId || '',
        bonus.worker?.name || '',
        bonus.hourlyRate || bonus.worker?.hourlyRate || 0,
        bonus.baseBonusAmount,
        bonus.totalDaysAbsent,
        bonus.totalPenalty,
        currentAdvanceDue,
        bonus.extraBonus || 0,
        bonus.employeeDeposit || 0,
        amountToGive
      ]);

      totalFinal += amountToGive;
      totalDeposit += bonus.employeeDeposit || 0;
      totalAdvanceDue += currentAdvanceDue;

      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

      // Color deposit cell in light green if has deposit (deposit is now column 10)
      if ((bonus.employeeDeposit || 0) > 0) {
        row.getCell(10).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFC8E6C9' }
        };
      }
    });

    // Total row
    worksheet.addRow([]);
    const totalRow = worksheet.addRow(['', '', '', '', '', '', '', totalAdvanceDue, '', totalDeposit, totalFinal]);
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
      { width: 14 }
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const filename = `bonus_payment_${startYear}_${startMonth}_to_${endYear}_${endMonth}.xlsx`;

    res.json({ base64, filename });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST export - accept records in body (useful for exporting current UI state with deposits)
router.post('/export/excel', async (req, res) => {
  try {
    const { startYear, startMonth, endYear, endMonth, records } = req.body;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Worker Management System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Bonus Payment');

    // Title
    worksheet.mergeCells('A1:L1');
    worksheet.getCell('A1').value = `Bonus Payment (Exported)`;
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A2:L2');
    worksheet.getCell('A2').value = 'Formula: Base Bonus = 30 days × 8 hours × Hourly Rate';
    worksheet.getCell('A2').font = { italic: true, size: 10 };
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    worksheet.addRow([]);

    // Headers (no status column)
    const headerRow = worksheet.addRow([
      'S.No',
      'Worker ID',
      'Worker Name',
      'Hourly Rate',
      'Base Bonus',
      'Absent Days',
      'Penalty',
      'Current Advance Due',
      'Extra Bonus',
      'Employee Deposit',
      'Final Amount'
    ]);

    headerRow.font = { bold: true };

    // Data rows
    let totalFinal = 0;
    let totalDeposit = 0;
    let totalAdvanceDue = 0;

    const rows = Array.isArray(records) && records.length > 0 ? records : [];

    rows.forEach((rec, index) => {
      const currentAdvanceDue = rec.currentAdvanceBalance || rec.currentAdvanceDue || 0;
      const deposit = rec.deposit || 0;
      const finalAmount = rec.amountToGiveEmployee ?? rec.finalBonusAmount ?? 0;

      const row = worksheet.addRow([
        index + 1,
        rec.workerId || '',
        rec.workerName || rec.workerName || '',
        rec.hourlyRate || 0,
        rec.baseBonusAmount || 0,
        rec.totalDaysAbsent || 0,
        rec.totalPenalty || 0,
        currentAdvanceDue,
        rec.extraBonus || 0,
        deposit,
        finalAmount
      ]);

      totalFinal += finalAmount;
      totalDeposit += deposit;
      totalAdvanceDue += currentAdvanceDue;

      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

      if (deposit > 0) {
        row.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8E6C9' } };
      }
    });

    // Total row
    worksheet.addRow([]);
    const totalRow = worksheet.addRow(['', '', '', '', '', '', '', totalAdvanceDue, '', totalDeposit, totalFinal]);
    totalRow.font = { bold: true };

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
      { width: 14 }
    ];

    const buffer2 = await workbook.xlsx.writeBuffer();
    const base642 = Buffer.from(buffer2).toString('base64');
    const filename2 = `bonus_payment_exported_${Date.now()}.xlsx`;

    res.json({ base64: base642, filename: filename2 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all bonuses for a year (placed at end to avoid shadowing routes like /date-range)
router.get('/:year', async (req, res) => {
  try {
    const year = parseInt(req.params.year, 10);
    if (Number.isNaN(year)) {
      return res.status(400).json({ error: 'Invalid year parameter' });
    }

    const bonuses = await Bonus.find({ year })
      .populate('worker', 'name workerId hourlyRate advanceBalance')
      .sort({ 'worker.name': 1 });

    res.json(bonuses);
  } catch (error) {
    console.error('GET /bonus/:year error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Save bonus report to history
router.post('/save-bonus-history', async (req, res) => {
  try {
    const { year, periodStart, periodEnd, records, notes } = req.body;

    if (!year || !periodStart || !periodEnd || !records || !Array.isArray(records)) {
      return res.status(400).json({ error: 'Missing required fields: year, periodStart, periodEnd, records' });
    }

    // Process each record and record deposits to advance
    const processedRecords = [];
    
    for (const record of records) {
      const worker = await Worker.findById(record.workerId);
      if (!worker) continue;

// If worker has a deposit, record it in the Advance system (same behavior as salary reports)
    if (record.deposit && record.deposit > 0) {
      const newBalance = Math.max(0, worker.advanceBalance - record.deposit);

      // Create advance record for the deposit
      await Advance.create({
        worker: worker._id,
        type: 'deposit',
        amount: record.deposit,
        date: new Date(),
        notes: `${worker.name} deposited ₹${record.deposit} from bonus`,
        balanceAfter: newBalance
      });

      // Update worker's advance balance
      await Worker.findByIdAndUpdate(worker._id, {
        advanceBalance: newBalance,
        $inc: { totalAdvanceRepaid: record.deposit }
      });
    }

      processedRecords.push({
        worker: worker._id,
        workerName: worker.name,
        workerId: worker.workerId,
        hourlyRate: worker.hourlyRate,
        baseBonusAmount: record.baseBonusAmount || 0,
        totalDaysWorked: record.totalDaysWorked || 0,
        totalDaysAbsent: record.totalDaysAbsent || 0,
        totalPenalty: record.totalPenalty || 0,
        // advanceDeduction intentionally omitted
        extraBonus: record.extraBonus || 0,
        deposit: record.deposit || 0,
        finalBonusAmount: record.finalBonusAmount || 0,
        amountToGiveEmployee: record.amountToGiveEmployee || 0,
        advanceBalanceAtSave: worker.advanceBalance
      });
    }

    // Calculate totals
    const totalBaseBonusAmount = processedRecords.reduce((sum, r) => sum + r.baseBonusAmount, 0);
    const totalPenalty = processedRecords.reduce((sum, r) => sum + r.totalPenalty, 0);
    const totalExtraBonus = processedRecords.reduce((sum, r) => sum + r.extraBonus, 0);
    const totalDeposit = processedRecords.reduce((sum, r) => sum + r.deposit, 0);
    const totalFinalAmount = processedRecords.reduce((sum, r) => sum + r.amountToGiveEmployee, 0);
    const totalAdvanceDue = processedRecords.reduce((sum, r) => sum + (r.advanceBalanceAtSave || 0), 0);

    // Create history record
    const history = new BonusHistory({
      year,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      savedDate: new Date(),
      records: processedRecords,
      totalBaseBonusAmount,
      totalPenalty,
      totalAdvanceDue,
      totalExtraBonus,
      totalDeposit,
      totalFinalAmount,
      notes,
      isSaved: true
    });

    await history.save();

    res.status(201).json({ 
      message: 'Bonus history saved successfully',
      history 
    });
  } catch (error) {
    console.error('POST /bonus/save-bonus-history error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all bonus history
router.get('/history/all', async (req, res) => {
  try {
    const { year } = req.query;
    
    const filter = {};
    if (year) {
      filter.year = parseInt(year);
    }

    const history = await BonusHistory.find(filter)
      .sort({ savedDate: -1 })
      .populate('records.worker', 'name workerId');

    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single bonus history record
router.get('/history/:id', async (req, res) => {
  try {
    const history = await BonusHistory.findById(req.params.id)
      .populate('records.worker', 'name workerId');
    
    if (!history) {
      return res.status(404).json({ error: 'Bonus history not found' });
    }

    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a saved bonus history
router.delete('/history/:id', async (req, res) => {
  try {
    const history = await BonusHistory.findById(req.params.id);
    if (!history) return res.status(404).json({ error: 'Bonus history not found' });

    await BonusHistory.findByIdAndDelete(req.params.id);

    // Note: We do not attempt to revert advance transactions here. Deleting a snapshot removes the saved report only.
    res.json({ message: 'Bonus history deleted' });
  } catch (error) {
    console.error('DELETE /bonus/history/:id error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export bonus history to Excel
router.get('/export/history/:historyId', async (req, res) => {
  try {
    const history = await BonusHistory.findById(req.params.historyId);
    
    if (!history) {
      return res.status(404).json({ error: 'Bonus history not found' });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Worker Management System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Bonus Report');

    const startDateStr = history.periodStart.toLocaleDateString('en-IN');
    const endDateStr = history.periodEnd.toLocaleDateString('en-IN');
    const savedDateStr = history.savedDate.toLocaleDateString('en-IN');

    // Title
    worksheet.mergeCells('A1:L1');
    worksheet.getCell('A1').value = `Bonus Report (${startDateStr} to ${endDateStr})`;
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A2:L2');
    worksheet.getCell('A2').value = `Saved on: ${savedDateStr}`;
    worksheet.getCell('A2').font = { italic: true, size: 10 };
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    worksheet.addRow([]);

    // Headers
    const headerRow = worksheet.addRow([
      'S.No',
      'Worker ID',
      'Name',
      'Hourly Rate',
      'Base Bonus',
      'Absent Days',
      'Penalty',
      'Current Advance Due',
      'Extra Bonus',
      'Deposit',
      'Final Amount'
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
    history.records.forEach((record, index) => {
      const row = worksheet.addRow([
        index + 1,
        record.workerId || '',
        record.workerName || '',
        record.hourlyRate || 0,
        record.baseBonusAmount || 0,
        record.totalDaysAbsent || 0,
        record.totalPenalty || 0,
        record.advanceBalanceAtSave || 0,
        record.extraBonus || 0,
        record.deposit || 0,
        record.amountToGiveEmployee || 0
      ]);

      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

      // Color deposit cell in light green if has deposit
      if (record.deposit > 0) {
        row.getCell(10).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFC8E6C9' }
        };
      }
    });

    // Total row
    worksheet.addRow([]);
    const totalRow = worksheet.addRow([
      '', '', '', '',
      history.totalBaseBonusAmount,
      '',
      history.totalPenalty,
      history.totalAdvanceDue || 0,
      history.totalExtraBonus,
      history.totalDeposit,
      history.totalFinalAmount
    ]);
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
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 14 }
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const filename = `bonus_report_${startDateStr.replace(/\//g, '-')}_to_${endDateStr.replace(/\//g, '-')}.xlsx`;

    res.json({ base64, filename });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
