import express from 'express';
import ExcelJS from 'exceljs';
import DailyEntry from '../models/DailyEntry.js';
import Worker from '../models/Worker.js';
import Advance from '../models/Advance.js';
import SalaryHistory from '../models/SalaryHistory.js';
import Settings from '../models/Settings.js';

const router = express.Router();

const months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Get all workers summary for a date range
router.get('/all-workers-summary', async (req, res) => {
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

    const entries = await DailyEntry.find(filter)
      .populate('worker', 'name workerId hourlyRate dailyWorkingHours advanceBalance bankDetails');

    // Group by worker
    const workerMap = {};
    
    entries.forEach(entry => {
      if (!entry.worker) return;
      const workerId = entry.worker._id.toString();
      if (!workerMap[workerId]) {
        workerMap[workerId] = {
          worker: entry.worker,
          totalHoursWorked: 0,
          totalRegularHours: 0,
          totalOvertimeHours: 0,
          totalRegularPay: 0,
          totalOvertimePay: 0,
          totalPay: 0,
          daysPresent: 0,
          daysAbsent: 0,
          entries: []
        };
      }
      workerMap[workerId].totalHoursWorked += entry.hoursWorked || 0;
      workerMap[workerId].totalRegularHours += entry.regularHours || 0;
      workerMap[workerId].totalOvertimeHours += entry.overtimeHours || 0;
      workerMap[workerId].totalRegularPay += entry.regularPay || 0;
      workerMap[workerId].totalOvertimePay += entry.overtimePay || 0;
      workerMap[workerId].totalPay += entry.totalPay || 0;
      
      if (entry.status === 'present' || entry.status === 'holiday') {
        workerMap[workerId].daysPresent++;
      } else if (entry.status === 'absent') {
        workerMap[workerId].daysAbsent++;
      }
      
      workerMap[workerId].entries.push(entry);
    });

    // NOTE: Deposits are NOT fetched automatically - they start as 0
    // User will add deposits manually in the UI, and they get saved to history
    const report = Object.values(workerMap).map((item) => {
      return {
        ...item,
        deposit: 0, // User adds this manually
        finalAmount: item.totalPay // Initially same as totalPay
      };
    });

    res.json({ report });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export work summary to Excel
router.get('/export/work-summary', async (req, res) => {
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

    const entries = await DailyEntry.find(filter)
      .populate('worker', 'name workerId hourlyRate dailyWorkingHours advanceBalance');

    // Group by worker
    const workerMap = {};
    
    entries.forEach(entry => {
      if (!entry.worker) return;
      const workerId = entry.worker._id.toString();
      if (!workerMap[workerId]) {
        workerMap[workerId] = {
          worker: entry.worker,
          totalHoursWorked: 0,
          totalPay: 0
        };
      }
      workerMap[workerId].totalHoursWorked += entry.hoursWorked || 0;
      workerMap[workerId].totalPay += entry.totalPay || 0;
    });

    // No deposit fetching - deposits handled separately
    const report = Object.values(workerMap).map((item) => ({
      ...item,
      deposit: 0,
      finalAmount: item.totalPay
    }));

    // Create Excel
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Worker Management System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Work Summary');

    const startDateStr = startDate ? new Date(startDate).toLocaleDateString('en-IN') : 'Beginning';
    const endDateStr = endDate ? new Date(endDate).toLocaleDateString('en-IN') : 'Present';

    // Optional company name at top
    const settings = await Settings.findOne({ key: 'general' });
    if (settings && settings.companyName) {
      worksheet.mergeCells('A1:I1');
      worksheet.getCell('A1').value = settings.companyName;
      worksheet.getCell('A1').font = { bold: true, size: 18 };
      worksheet.getCell('A1').alignment = { horizontal: 'center' };

      // Title on next row
      worksheet.mergeCells('A2:I2');
      worksheet.getCell('A2').value = `Work Summary Report (${startDateStr} to ${endDateStr})`;
      worksheet.getCell('A2').font = { bold: true, size: 16 };
      worksheet.getCell('A2').alignment = { horizontal: 'center' };

      worksheet.addRow([]);
    } else {
      // Title
      worksheet.mergeCells('A1:I1');
      worksheet.getCell('A1').value = `Work Summary Report (${startDateStr} to ${endDateStr})`;
      worksheet.getCell('A1').font = { bold: true, size: 16 };
      worksheet.getCell('A1').alignment = { horizontal: 'center' };

      worksheet.addRow([]);
    }

    // Headers
    const headerRow = worksheet.addRow([
      'S.No',
      'Worker ID',
      'Name',
      'Per Hr Rate (₹)',
      'Total Hours',
      'Amount (₹)',
      'Advance Taken (₹)',
      'Deposit (₹)',
      'Final Amount (₹)'
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
    let totalAmount = 0;
    let totalAdvances = 0;
    let totalDeposits = 0;
    let totalFinal = 0;

    report.forEach((item, index) => {
      const row = worksheet.addRow([
        index + 1,
        item.worker?.workerId || '',
        item.worker?.name || '',
        Math.round((item.worker?.hourlyRate || 0) * 100) / 100,
        Math.round((item.totalHoursWorked || 0) * 100) / 100,
        Math.round((item.totalPay || 0) * 100) / 100,
        Math.round((item.totalAdvanceTaken || 0) * 100) / 100,
        Math.round((item.totalDeposit || 0) * 100) / 100,
        Math.round((item.finalAmount || 0) * 100) / 100
      ]);

      totalAmount += item.totalPay || 0;
      totalAdvances += item.totalAdvanceTaken || 0;
      totalDeposits += item.totalDeposit || 0;
      totalFinal += item.finalAmount || 0;

      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });

      // Color advance cell in light red
      row.getCell(7).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFCCCC' }
      };
      
      // Color deposit cell in light green
      row.getCell(8).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFCCFFCC' }
      };
    });

    // Total row
    worksheet.addRow([]);
    const totalRow = worksheet.addRow([
      '', '', '', '', 'TOTAL:',
      Math.round(totalAmount * 100) / 100,
      Math.round(totalAdvances * 100) / 100,
      Math.round(totalDeposits * 100) / 100,
      Math.round(totalFinal * 100) / 100
    ]);
    totalRow.font = { bold: true };

    // Column widths and formats
    worksheet.columns = [
      { width: 8 },
      { width: 15 },
      { width: 25 },
      { width: 15 },
      { width: 15 },
      { width: 15 },
      { width: 18 },
      { width: 15 },
      { width: 18 }
    ];

    // Apply number formats to numeric columns
    worksheet.getColumn(4).numFmt = '0.00'; // Per Hr Rate
    worksheet.getColumn(5).numFmt = '0.00'; // Total Hours
    worksheet.getColumn(6).numFmt = '#,##0.00'; // Amount
    worksheet.getColumn(7).numFmt = '#,##0.00'; // Advance Taken
    worksheet.getColumn(8).numFmt = '#,##0.00'; // Deposit
    worksheet.getColumn(9).numFmt = '#,##0.00'; // Final Amount

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const filename = `work_summary_${startDateStr.replace(/\//g, '-')}_to_${endDateStr.replace(/\//g, '-')}.xlsx`;

    res.json({ base64, filename });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST export - accept records in body (useful for exporting current UI state with deposits)
router.post('/export/work-summary', async (req, res) => {
  try {
    const { startDate, endDate, records } = req.body;

    let report = [];

    if (Array.isArray(records) && records.length > 0) {
      // Use provided records (expected: workerId, workerName, hourlyRate, totalHoursWorked, totalPay, deposit, finalAmount)
      report = records.map(r => ({
        worker: r.worker || null,
        workerId: r.workerId || (r.worker && r.worker.workerId) || '',
        workerName: r.workerName || (r.worker && r.worker.name) || '',
        hourlyRate: r.hourlyRate || (r.worker && r.worker.hourlyRate) || 0,
        totalHoursWorked: r.totalHoursWorked || 0,
        totalPay: r.totalPay || 0,
        deposit: r.deposit || 0,
        finalAmount: r.finalAmount || r.totalPay || 0
      }));
    } else {
      // Fallback to DB-backed export same as GET
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

      const entries = await DailyEntry.find(filter)
        .populate('worker', 'name workerId hourlyRate dailyWorkingHours advanceBalance');

      const workerMap = {};
      entries.forEach(entry => {
        if (!entry.worker) return;
        const workerId = entry.worker._id.toString();
        if (!workerMap[workerId]) {
          workerMap[workerId] = {
            worker: entry.worker,
            totalHoursWorked: 0,
            totalPay: 0
          };
        }
        workerMap[workerId].totalHoursWorked += entry.hoursWorked || 0;
        workerMap[workerId].totalPay += entry.totalPay || 0;
      });

      report = Object.values(workerMap).map((item) => ({
        ...item,
        deposit: 0,
        finalAmount: item.totalPay
      }));
    }

    // Build Excel using `report` array
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Worker Management System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Work Summary');

    const startDateStr = startDate ? new Date(startDate).toLocaleDateString('en-IN') : 'Beginning';
    const endDateStr = endDate ? new Date(endDate).toLocaleDateString('en-IN') : 'Present';

    // Optional company name at top
    const settings = await Settings.findOne({ key: 'general' });
    if (settings && settings.companyName) {
      worksheet.mergeCells('A1:H1');
      worksheet.getCell('A1').value = settings.companyName;
      worksheet.getCell('A1').font = { bold: true, size: 18 };
      worksheet.getCell('A1').alignment = { horizontal: 'center' };

      // Title on next row
      worksheet.mergeCells('A2:H2');
      worksheet.getCell('A2').value = `Work Summary (${startDateStr} to ${endDateStr})`;
      worksheet.getCell('A2').font = { bold: true, size: 16 };
      worksheet.getCell('A2').alignment = { horizontal: 'center' };

      worksheet.addRow([]);
    } else {
      // Title
      worksheet.mergeCells('A1:H1');
      worksheet.getCell('A1').value = `Work Summary (${startDateStr} to ${endDateStr})`;
      worksheet.getCell('A1').font = { bold: true, size: 16 };
      worksheet.getCell('A1').alignment = { horizontal: 'center' };

      worksheet.addRow([]);
    }

    const headerRow = worksheet.addRow(['S.No','Worker ID','Name','Per Hr Rate (₹)','Total Hours','Amount (₹)','Deposit (₹)','Final Amount (₹)']);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });

    report.forEach((rec, index) => {
      const row = worksheet.addRow([
        index + 1,
        rec.workerId || '',
        rec.workerName || (rec.worker && rec.worker.name) || '',
        rec.hourlyRate || 0,
        rec.totalHoursWorked || 0,
        rec.totalPay || 0,
        rec.deposit || 0,
        rec.finalAmount || 0
      ]);
      row.eachCell((cell) => {
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });
      if (rec.deposit > 0) {
        row.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8E6C9' } };
      }
    });

    worksheet.addRow([]);
    const totalAmount = report.reduce((sum, r) => sum + (r.totalPay || 0), 0);
    const totalDeposit = report.reduce((sum, r) => sum + (r.deposit || 0), 0);
    const totalFinal = report.reduce((sum, r) => sum + (r.finalAmount || 0), 0);

    const totalRow = worksheet.addRow(['', '', '', '', 'TOTAL:', totalAmount, totalDeposit, totalFinal]);
    totalRow.font = { bold: true };

    worksheet.columns = [ { width: 8 }, { width: 15 }, { width: 25 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 18 } ];

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const filename = `work_summary_${startDateStr.replace(/\//g, '-')}_to_${endDateStr.replace(/\//g, '-')}.xlsx`;

    res.json({ base64, filename });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get monthly overtime report
router.get('/overtime/:year/:month', async (req, res) => {
  try {
    const { year, month } = req.params;
    
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const entries = await DailyEntry.find({
      date: { $gte: startDate, $lte: endDate },
      overtimeHours: { $gt: 0 }
    }).populate('worker', 'name workerId bankDetails hourlyRate dailyWorkingHours');

    // Group by worker
    const workerOvertimeMap = {};
    
    entries.forEach(entry => {
      const workerId = entry.worker._id.toString();
      if (!workerOvertimeMap[workerId]) {
        workerOvertimeMap[workerId] = {
          worker: entry.worker,
          totalOvertimeHours: 0,
          totalOvertimePay: 0,
          entries: []
        };
      }
      workerOvertimeMap[workerId].totalOvertimeHours += entry.overtimeHours;
      workerOvertimeMap[workerId].totalOvertimePay += entry.overtimePay;
      workerOvertimeMap[workerId].entries.push({
        date: entry.date,
        overtimeHours: entry.overtimeHours,
        overtimePay: entry.overtimePay
      });
    });

    const report = Object.values(workerOvertimeMap);
    
    res.json({
      month: parseInt(month),
      year: parseInt(year),
      report
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export monthly overtime to Excel
router.get('/export/overtime/:year/:month', async (req, res) => {
  try {
    const { year, month } = req.params;
    
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const entries = await DailyEntry.find({
      date: { $gte: startDate, $lte: endDate },
      overtimeHours: { $gt: 0 }
    }).populate('worker', 'name workerId bankDetails hourlyRate dailyWorkingHours');

    // Group by worker
    const workerOvertimeMap = {};
    
    entries.forEach(entry => {
      const workerId = entry.worker._id.toString();
      if (!workerOvertimeMap[workerId]) {
        workerOvertimeMap[workerId] = {
          worker: entry.worker,
          totalOvertimeHours: 0,
          totalOvertimePay: 0
        };
      }
      workerOvertimeMap[workerId].totalOvertimeHours += entry.overtimeHours;
      workerOvertimeMap[workerId].totalOvertimePay += entry.overtimePay;
    });

    const report = Object.values(workerOvertimeMap);

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Worker Management System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Overtime Payment');

    // Add title
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    
    worksheet.mergeCells('A1:G1');
    worksheet.getCell('A1').value = `Overtime Payment Sheet - ${monthNames[month - 1]} ${year}`;
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    // Add headers
    worksheet.addRow([]);
    const headerRow = worksheet.addRow([
      'S.No',
      'Worker ID',
      'Worker Name',
      'Bank Name',
      'Account Number',
      'IFSC Code',
      'Total OT Hours',
      'Total OT Pay (₹)'
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

    // Add data rows
    let totalOvertimePay = 0;
    report.forEach((item, index) => {
      const row = worksheet.addRow([
        index + 1,
        item.worker.workerId,
        item.worker.name,
        item.worker.bankDetails?.bankName || '',
        item.worker.bankDetails?.accountNumber || '',
        item.worker.bankDetails?.ifscCode || '',
        Math.round((item.totalOvertimeHours || 0) * 100) / 100,
        Math.round((item.totalOvertimePay || 0) * 100) / 100
      ]);
      
      totalOvertimePay += item.totalOvertimePay || 0;

      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });

    // Add total row
    worksheet.addRow([]);
    const totalRow = worksheet.addRow([
      '', '', '', '', '', 'TOTAL:',
      Math.round(report.reduce((sum, item) => sum + (item.totalOvertimeHours || 0), 0) * 100) / 100,
      Math.round(totalOvertimePay * 100) / 100
    ]);
    totalRow.font = { bold: true };

    // Set column widths
    worksheet.columns = [
      { width: 8 },
      { width: 15 },
      { width: 25 },
      { width: 20 },
      { width: 20 },
      { width: 15 },
      { width: 15 },
      { width: 18 }
    ];

    // Apply number formats to overtime columns
    worksheet.getColumn(7).numFmt = '0.00'; // Overtime Hours
    worksheet.getColumn(8).numFmt = '#,##0.00'; // Overtime Pay

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Return as base64 JSON to simplify client handling across web and mobile
    const base64 = Buffer.from(buffer).toString('base64');
    const filename = `overtime_${year}_${month}.xlsx`;

    res.json({ base64, filename });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get worker payment summary
router.get('/worker-summary/:workerId', async (req, res) => {
  try {
    const { workerId } = req.params;
    const { startDate, endDate } = req.query;

    const filter = { worker: workerId };
    
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    const entries = await DailyEntry.find(filter).sort({ date: -1 });
    
    const summary = {
      totalEntries: entries.length,
      totalHoursWorked: entries.reduce((sum, e) => sum + e.hoursWorked, 0),
      totalRegularHours: entries.reduce((sum, e) => sum + e.regularHours, 0),
      totalOvertimeHours: entries.reduce((sum, e) => sum + e.overtimeHours, 0),
      totalRegularPay: entries.reduce((sum, e) => sum + e.regularPay, 0),
      totalOvertimePay: entries.reduce((sum, e) => sum + e.overtimePay, 0),
      totalPay: entries.reduce((sum, e) => sum + e.totalPay, 0),
      entries
    };

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save salary report to history
router.post('/save-salary-history', async (req, res) => {
  try {
    const { periodStart, periodEnd, records, notes } = req.body;

    if (!periodStart || !periodEnd || !records || !Array.isArray(records)) {
      return res.status(400).json({ error: 'Missing required fields: periodStart, periodEnd, records' });
    }

    // Process each record and record deposits to advance
    const processedRecords = [];
    
    for (const record of records) {
      const worker = await Worker.findById(record.workerId);
      if (!worker) continue;

      // Validate deposit against current advance balance
      if (record.deposit && record.deposit > 0) {
        const currentBalance = worker.advanceBalance || 0;
        if (currentBalance <= 0) {
          return res.status(400).json({ error: `No advance balance for ${worker.name}` });
        }
        if (record.deposit > currentBalance) {
          return res.status(400).json({ error: `Deposit for ${worker.name} exceeds advance balance` });
        }

        const newBalance = currentBalance - record.deposit;
        
        // Create advance record for the deposit
        await Advance.create({
          worker: worker._id,
          type: 'deposit',
          amount: record.deposit,
          date: new Date(),
          notes: `${worker.name} deposited ₹${record.deposit} from salary`,
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
        totalHoursWorked: record.totalHoursWorked || 0,
        totalPay: record.totalPay || 0,
        deposit: record.deposit || 0,
        finalAmount: record.finalAmount || 0,
        advanceBalanceAtSave: worker.advanceBalance
      });
    }

    // Calculate totals
    const totalHours = processedRecords.reduce((sum, r) => sum + r.totalHoursWorked, 0);
    const totalAmount = processedRecords.reduce((sum, r) => sum + r.totalPay, 0);
    const totalDeposit = processedRecords.reduce((sum, r) => sum + r.deposit, 0);
    const totalFinal = processedRecords.reduce((sum, r) => sum + r.finalAmount, 0);

    // Create history record
    const history = new SalaryHistory({
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      savedDate: new Date(),
      records: processedRecords,
      totalHours,
      totalAmount,
      totalDeposit,
      totalFinal,
      notes,
      isSaved: true
    });

    await history.save();

    res.status(201).json({ 
      message: 'Salary history saved successfully',
      history 
    });
  } catch (error) {
    console.error('POST /reports/save-salary-history error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all salary history
router.get('/salary-history', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const filter = {};
    if (startDate || endDate) {
      filter.savedDate = {};
      if (startDate) filter.savedDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.savedDate.$lte = end;
      }
    }

    const history = await SalaryHistory.find(filter)
      .sort({ savedDate: -1 })
      .populate('records.worker', 'name workerId');

    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single salary history record
router.get('/salary-history/:id', async (req, res) => {
  try {
    const history = await SalaryHistory.findById(req.params.id)
      .populate('records.worker', 'name workerId');
    
    if (!history) {
      return res.status(404).json({ error: 'Salary history not found' });
    }

    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export salary history to Excel (with deposits)
router.get('/export/salary-history/:historyId', async (req, res) => {
  try {
    const history = await SalaryHistory.findById(req.params.historyId);
    
    if (!history) {
      return res.status(404).json({ error: 'Salary history not found' });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Worker Management System';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Salary Report');

    const startDateStr = history.periodStart.toLocaleDateString('en-IN');
    const endDateStr = history.periodEnd.toLocaleDateString('en-IN');
    const savedDateStr = history.savedDate.toLocaleDateString('en-IN');

    // Title
    worksheet.mergeCells('A1:H1');
    worksheet.getCell('A1').value = `Salary Report (${startDateStr} to ${endDateStr})`;
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    worksheet.mergeCells('A2:H2');
    worksheet.getCell('A2').value = `Saved on: ${savedDateStr}`;
    worksheet.getCell('A2').font = { italic: true, size: 10 };
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    worksheet.addRow([]);

    // Headers
    const headerRow = worksheet.addRow([
      'S.No',
      'Worker ID',
      'Name',
      'Per Hr Rate (₹)',
      'Total Hours',
      'Amount (₹)',
      'Deposit (₹)',
      'Final Amount (₹)'
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
        record.totalHoursWorked || 0,
        record.totalPay || 0,
        record.deposit || 0,
        record.finalAmount || 0
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
        row.getCell(7).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFC8E6C9' }
        };
      }
    });

    // Total row
    worksheet.addRow([]);
    const totalRow = worksheet.addRow([
      '', '', '', '', 'TOTAL:',
      history.totalAmount,
      history.totalDeposit,
      history.totalFinal
    ]);
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
      { width: 18 }
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const filename = `salary_report_${startDateStr.replace(/\//g, '-')}_to_${endDateStr.replace(/\//g, '-')}.xlsx`;

    res.json({ base64, filename });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
