import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { SecurityScore } from './securityScore';

export async function buildExecutiveReport(score: SecurityScore, generatedAt = new Date().toISOString()) {
  const document = await PDFDocument.create();
  const page = document.addPage([595, 842]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);

  page.drawText('DurtOne Security Report', { x: 48, y: 770, size: 24, font: bold, color: rgb(0.06, 0.18, 0.2) });
  page.drawText(`Generated at ${generatedAt}`, { x: 48, y: 742, size: 10, font: regular, color: rgb(0.35, 0.4, 0.4) });
  page.drawText(`Unified Security Score: ${score.score}/100`, { x: 48, y: 680, size: 20, font: bold, color: rgb(0.05, 0.45, 0.42) });

  const rows: Array<[string, string, string]> = [
    ['DurtWall efficacy', `${score.components.waf}/100`, '40%'],
    ['DurtGuardian posture', `${score.components.cspm}/100`, '30%'],
    ['DurtScope hygiene', `${score.components.itdr}/100`, '30%'],
  ];
  let y = 620;
  for (const [label, value, weight] of rows) {
    page.drawText(label, { x: 60, y, size: 13, font: regular });
    page.drawText(value, { x: 360, y, size: 13, font: bold });
    page.drawText(weight, { x: 450, y, size: 13, font: regular, color: rgb(0.35, 0.4, 0.4) });
    y -= 34;
  }

  page.drawText('This report is generated from the latest Control Plane telemetry.', { x: 48, y: 100, size: 10, font: regular, color: rgb(0.35, 0.4, 0.4) });
  return document.save();
}
