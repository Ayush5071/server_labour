import express from 'express';
import ExcelJS from 'exceljs';
import DailyEntry from '../models/DailyEntry.js';
import Worker from '../models/Worker.js';

const router = express.Router();

// Get monthly overtime report
router.get('/overtime/:year/:month', async (req, res) => {
  try {
    const { year, month } = req.params;
    
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const entries = await DailyEntry.find({
      date: { $gte: startDate, $lte: endDate },
      overtimeHours: { $gt: 0 }
    }).populate('worker', 'name workerId bankDetails dailyPay dailyWorkingHours overtimeRate');

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
    }).populate('worker', 'name workerId bankDetails dailyPay dailyWorkingHours overtimeRate');

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
        item.totalOvertimeHours.toFixed(2),
        item.totalOvertimePay.toFixed(2)
      ]);
      
      totalOvertimePay += item.totalOvertimePay;

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
      report.reduce((sum, item) => sum + item.totalOvertimeHours, 0).toFixed(2),
      totalOvertimePay.toFixed(2)
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

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=overtime_${year}_${month}.xlsx`);
    res.send(buffer);
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

export default router;
