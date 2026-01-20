import express from 'express';
import Bonus from '../models/Bonus.js';
import Worker from '../models/Worker.js';
import DailyEntry from '../models/DailyEntry.js';
import Advance from '../models/Advance.js';

const router = express.Router();

// Get all bonuses for a year
router.get('/:year', async (req, res) => {
  try {
    const bonuses = await Bonus.find({ year: parseInt(req.params.year) })
      .populate('worker', 'name workerId dailyPay advanceBalance')
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
      .populate('worker', 'name workerId dailyPay advanceBalance')
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
      .populate('worker', 'name workerId');

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

export default router;
