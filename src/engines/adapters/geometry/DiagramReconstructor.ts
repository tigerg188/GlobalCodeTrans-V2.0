import type {
  DiagramReconstructionSpec,
  EngineeringProfileSpec,
  DataChartSpec,
  SchematicDiagramSpec,
  ProfileBandCell,
} from '../../../domain/document/DocumentIR';

const DIAGRAM_FONT_STACK =
  '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans Lao", "Segoe UI", system-ui, sans-serif';

const CHART_PALETTE = [
  '#2563EB',
  '#DC2626',
  '#059669',
  '#D97706',
  '#7C3AED',
  '#0891B2',
  '#DB2777',
];

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = (text || '').split(/\r?\n/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }

    let current = '';
    const tokens = para.match(/(\S+\s*)/g) || [para];
    for (const token of tokens) {
      const candidate = current + token;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        if (current.trimEnd()) {
          lines.push(current.trimEnd());
          current = '';
        }
        if (ctx.measureText(token).width > maxWidth) {
          let charBuf = '';
          for (const ch of Array.from(token)) {
            if (ctx.measureText(charBuf + ch).width > maxWidth && charBuf.length > 0) {
              lines.push(charBuf);
              charBuf = ch;
            } else {
              charBuf += ch;
            }
          }
          current = charBuf;
        } else {
          current = token.trimStart();
        }
      }
    }
    if (current.trimEnd()) {
      lines.push(current.trimEnd());
    }
  }
  return lines.length > 0 ? lines : [''];
}

function drawFittedTextBox(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  options: {
    maxFontSize?: number;
    minFontSize?: number;
    weight?: 'normal' | 'bold';
    color?: string;
    align?: 'left' | 'center' | 'right';
    padding?: number;
  } = {}
): void {
  const clean = (text || '').trim();
  if (!clean) return;
  const pad = options.padding ?? 8;
  const availW = Math.max(16, w - pad * 2);
  const availH = Math.max(14, h - pad * 2);
  const weight = options.weight === 'bold' ? '700' : '500';
  const maxFs = options.maxFontSize ?? 26;
  const minFs = options.minFontSize ?? 11;

  let chosenSize = Math.min(maxFs, Math.max(minFs, Math.floor(availH * 0.65)));
  let chosenLines = [clean];
  let chosenLh = Math.ceil(chosenSize * 1.24);

  for (let fs = chosenSize; fs >= minFs; fs -= 1) {
    ctx.font = `${weight} ${fs}px ${DIAGRAM_FONT_STACK}`;
    const wrapped = wrapLines(ctx, clean, availW);
    const lh = Math.max(14, Math.ceil(fs * 1.24));
    const totalH = wrapped.length * lh;
    const widest = Math.max(...wrapped.map((l) => ctx.measureText(l).width), 0);
    if (totalH <= availH && widest <= availW + 2) {
      chosenSize = fs;
      chosenLines = wrapped;
      chosenLh = lh;
      break;
    }
    if (fs === minFs) {
      chosenSize = minFs;
      chosenLines = wrapped;
      chosenLh = lh;
    }
  }

  ctx.save();
  ctx.font = `${weight} ${chosenSize}px ${DIAGRAM_FONT_STACK}`;
  ctx.fillStyle = options.color ?? '#0F172A';
  ctx.textBaseline = 'middle';

  const blockH = chosenLines.length * chosenLh;
  const startY = y + h / 2 - blockH / 2 + chosenLh / 2;
  const align = options.align ?? 'center';
  ctx.textAlign = align;

  const anchorX =
    align === 'left' ? x + pad : align === 'right' ? x + w - pad : x + w / 2;

  chosenLines.forEach((line, idx) => {
    ctx.fillText(line, anchorX, startY + idx * chosenLh, availW);
  });
  ctx.restore();
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  size = 12,
  color = '#1E293B'
): void {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - size * Math.cos(angle - Math.PI / 6),
    toY - size * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    toX - size * Math.cos(angle + Math.PI / 6),
    toY - size * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function interpolatePolylineY(
  points: Array<{ xMeters: number; elevation: number }>,
  xMeters: number
): number | null {
  if (points.length === 0) return null;
  if (xMeters <= points[0].xMeters) return points[0].elevation;
  if (xMeters >= points[points.length - 1].xMeters) {
    return points[points.length - 1].elevation;
  }
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    if (xMeters >= p1.xMeters && xMeters <= p2.xMeters) {
      const span = p2.xMeters - p1.xMeters;
      if (span <= 0) return p1.elevation;
      const t = (xMeters - p1.xMeters) / span;
      return p1.elevation + t * (p2.elevation - p1.elevation);
    }
  }
  return points[points.length - 1].elevation;
}

function normalizeBandSpans(
  cells: ProfileBandCell[],
  totalLength: number
): Array<{ xStart: number; xEnd: number; text: string; color?: 'dark' | 'red' | 'blue' }> {
  if (cells.length === 0) return [];
  const hasExplicitBounds = cells.every(
    (c) => typeof c.xStart === 'number' && typeof c.xEnd === 'number' && c.xEnd > c.xStart
  );
  if (hasExplicitBounds) {
    const maxEnd = Math.max(...cells.map((c) => c.xEnd as number), totalLength);
    const scale = maxEnd > 0 ? totalLength / maxEnd : 1;
    return cells.map((c) => ({
      xStart: (c.xStart as number) * scale,
      xEnd: (c.xEnd as number) * scale,
      text: c.text,
      color: c.color,
    }));
  }

  // Handle cells that specify xStart without xEnd by inferring xEnd from next cell or totalLength
  if (cells.every((c) => typeof c.xStart === 'number')) {
    const sorted = [...cells].sort((a, b) => (a.xStart as number) - (b.xStart as number));
    const maxStart = Math.max(...sorted.map((c) => c.xStart as number), 0);
    const estEnd = Math.max(totalLength, maxStart + 1);
    return sorted.map((c, idx) => {
      const xs = c.xStart as number;
      const xe =
        typeof c.xEnd === 'number' && c.xEnd > xs
          ? c.xEnd
          : idx < sorted.length - 1
            ? Math.max(xs + 1, sorted[idx + 1].xStart as number)
            : estEnd;
      return { xStart: xs, xEnd: xe, text: c.text, color: c.color };
    });
  }

  // Try interpreting numeric cell texts as segment widths
  const parsedWidths = cells.map((c) => {
    const n = Number(String(c.text).replace(',', '.').replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : NaN;
  });
  if (parsedWidths.every((n) => !Number.isNaN(n))) {
    const sum = parsedWidths.reduce((a, b) => a + b, 0);
    const scale = sum > 0 ? totalLength / sum : 1;
    let cursor = 0;
    return cells.map((c, idx) => {
      const w = parsedWidths[idx] * scale;
      const seg = { xStart: cursor, xEnd: cursor + w, text: c.text, color: c.color };
      cursor += w;
      return seg;
    });
  }

  const step = totalLength / cells.length;
  return cells.map((c, idx) => ({
    xStart: idx * step,
    xEnd: (idx + 1) * step,
    text: c.text,
    color: c.color,
  }));
}

function renderEngineeringProfile(spec: EngineeringProfileSpec): string {
  const canvasW = 2400;
  const padLeft = 60;
  const padRight = 90;
  const padTop = 44;
  const padBottom = 48;
  const labelColW = 320;
  const plotLeft = padLeft + labelColW;
  const plotRight = canvasW - padRight;
  const plotW = plotRight - plotLeft;
  const plotTop = padTop + 16;
  const plotH = 660;
  const plotBaselineY = plotTop + plotH;

  const bandHeights: Record<string, number> = {
    STATION_NUMBERS: 56,
    INTERVAL_SPAN: 52,
    VERTICAL_VALUE: 142,
    SLOPE_SEGMENT: 78,
    CURVE_PLAN: 176,
  };
  const bands = spec.bands || [];
  const totalBandsH = bands.reduce(
    (sum, b) => sum + (bandHeights[b.bandType] ?? 68),
    0
  );
  const canvasH = plotBaselineY + totalBandsH + padBottom;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Clean crisp white background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasW, canvasH);

  const baseline = Number.isFinite(spec.baselineValue)
    ? spec.baselineValue
    : spec.yMin - (spec.yStep || 1);
  const yMax = Math.max(spec.yMax, baseline + 2);
  const yStep = spec.yStep > 0 ? spec.yStep : 1;
  const totalLen = spec.totalLength > 0 ? spec.totalLength : 800;

  const xOf = (xm: number) =>
    plotLeft + (Math.max(0, Math.min(totalLen, xm)) / totalLen) * plotW;

  const topElevationMargin = (yMax - baseline) * 0.14;
  const ySpan = yMax + topElevationMargin - baseline;
  const yOf = (elev: number) =>
    plotBaselineY - ((elev - baseline) / ySpan) * plotH;

  // 1. Top title & scale lines inside plot sky region (non-overlapping)
  ctx.save();
  ctx.font = `700 32px ${DIAGRAM_FONT_STACK}`;
  ctx.fillStyle = '#0F172A';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(spec.title?.translated || '工程纵断面图', plotLeft + 28, plotTop + 6);

  if (spec.scaleLines && spec.scaleLines.length > 0) {
    ctx.font = `500 22px ${DIAGRAM_FONT_STACK}`;
    ctx.fillStyle = '#1E293B';
    ctx.textAlign = 'right';
    spec.scaleLines.forEach((line, idx) => {
      ctx.fillText(line.translated, plotRight - 24, plotTop + 8 + idx * 30);
    });
  }
  ctx.restore();

  // 2. Sort ground & design points
  const groundPts = [...(spec.groundPoints || [])].sort((a, b) => a.xMeters - b.xMeters);
  const designPts = [...(spec.designPoints || [])].sort((a, b) => a.xMeters - b.xMeters);

  // 3. Cut/fill diagonal hatching between ground profile and design profile
  if (groundPts.length >= 2 && designPts.length >= 2) {
    ctx.save();
    ctx.beginPath();
    groundPts.forEach((p, idx) => {
      const px = xOf(p.xMeters);
      const py = yOf(p.elevation);
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    for (let i = designPts.length - 1; i >= 0; i--) {
      ctx.lineTo(xOf(designPts[i].xMeters), yOf(designPts[i].elevation));
    }
    ctx.closePath();
    ctx.clip();

    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 1.3;
    const step = 11;
    for (let d = -plotH; d < plotW + plotH; d += step) {
      ctx.beginPath();
      ctx.moveTo(plotLeft + d, plotBaselineY);
      ctx.lineTo(plotLeft + d + plotH, plotTop);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 4. Vertical drop lines from ground points to baseline
  ctx.save();
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.4;
  for (const pt of groundPts) {
    const px = xOf(pt.xMeters);
    const gy = yOf(pt.elevation);
    ctx.beginPath();
    ctx.moveTo(px, gy);
    ctx.lineTo(px, plotBaselineY);
    ctx.stroke();
  }

  // Also ensure station verticals up to ground/design max
  for (const st of spec.stations || []) {
    const px = xOf(st.xMeters);
    const gElev = interpolatePolylineY(groundPts, st.xMeters);
    const dElev = interpolatePolylineY(designPts, st.xMeters);
    const topElev = Math.max(gElev ?? baseline, dElev ?? baseline);
    if (topElev > baseline) {
      ctx.beginPath();
      ctx.moveTo(px, yOf(topElev));
      ctx.lineTo(px, plotBaselineY);
      ctx.stroke();
    }
  }
  ctx.restore();

  // 5. Ground polyline (solid dark) and Design polyline (solid crimson/accent)
  if (groundPts.length >= 2) {
    ctx.save();
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    groundPts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(xOf(p.xMeters), yOf(p.elevation));
      else ctx.lineTo(xOf(p.xMeters), yOf(p.elevation));
    });
    ctx.stroke();
    ctx.restore();
  }

  if (designPts.length >= 2) {
    ctx.save();
    ctx.strokeStyle = '#B91C1C';
    ctx.lineWidth = 2.8;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    designPts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(xOf(p.xMeters), yOf(p.elevation));
      else ctx.lineTo(xOf(p.xMeters), yOf(p.elevation));
    });
    ctx.stroke();
    ctx.restore();
  }

  // 6. Vertical cut/fill difference labels along drop lines (with clean white halo)
  if (spec.verticalDiffs && spec.verticalDiffs.length > 0) {
    ctx.save();
    ctx.font = `600 17px ${DIAGRAM_FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let prevLabelX = -999;
    for (const vd of [...spec.verticalDiffs].sort((a, b) => a.xMeters - b.xMeters)) {
      let px = xOf(vd.xMeters);
      if (px - prevLabelX < 24) px = prevLabelX + 24;
      prevLabelX = px;
      const gElev = interpolatePolylineY(groundPts, vd.xMeters) ?? baseline + 2;
      const dElev = interpolatePolylineY(designPts, vd.xMeters) ?? gElev;
      const midElev = (gElev + dElev) / 2;
      const py = Math.min(plotBaselineY - 40, Math.max(plotTop + 70, yOf(midElev)));

      ctx.save();
      ctx.translate(px + 12, py);
      ctx.rotate(-Math.PI / 2);
      const tw = ctx.measureText(vd.text).width;
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.fillRect(-tw / 2 - 4, -10, tw + 8, 20);
      ctx.fillStyle = '#0F172A';
      ctx.fillText(vd.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  // 7. Left & Right Elevation Scales (alternating black/white elevation bars + labels)
  const drawVerticalAxisBar = (axisX: number, isLeft: boolean) => {
    const barW = 10;
    const barX = isLeft ? axisX - barW : axisX;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0F172A';

    for (let e = baseline; e < yMax; e += yStep) {
      const nextE = Math.min(yMax, e + yStep);
      const yBottom = yOf(e);
      const yTop = yOf(nextE);
      const stepIdx = Math.round((e - baseline) / yStep);
      ctx.fillStyle = stepIdx % 2 === 0 ? '#0F172A' : '#FFFFFF';
      ctx.fillRect(barX, yTop, barW, yBottom - yTop);
      ctx.strokeRect(barX, yTop, barW, yBottom - yTop);
    }

    ctx.font = `500 18px ${DIAGRAM_FONT_STACK}`;
    ctx.fillStyle = '#0F172A';
    ctx.textBaseline = 'middle';
    ctx.textAlign = isLeft ? 'right' : 'left';
    const textX = isLeft ? barX - 8 : barX + barW + 8;

    for (let e = spec.yMin; e <= yMax + 1e-6; e += yStep) {
      const py = yOf(e);
      ctx.fillText(String(Math.round(e * 100) / 100), textX, py);
    }
    ctx.restore();
  };

  drawVerticalAxisBar(plotLeft, true);
  drawVerticalAxisBar(plotRight, false);

  // Datum label neatly to the left of baseline (zero overlap with left axis numbers)
  if (spec.datumLabel?.translated) {
    drawFittedTextBox(
      ctx,
      spec.datumLabel.translated,
      padLeft,
      plotBaselineY - 34,
      labelColW - 70,
      32,
      {
        maxFontSize: 20,
        minFontSize: 13,
        weight: 'bold',
        color: '#0F172A',
        align: 'left',
        padding: 4,
      }
    );
  }

  // Baseline horizontal line
  ctx.save();
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(padLeft, plotBaselineY);
  ctx.lineTo(plotRight, plotBaselineY);
  ctx.stroke();
  ctx.restore();

  // 8. Bottom Data Bands Table (100% crisp alignment, dedicated rowTitle column)
  let curY = plotBaselineY;
  for (const band of bands) {
    const rowH = bandHeights[band.bandType] ?? 68;

    // Outer borders
    ctx.save();
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.6;
    ctx.strokeRect(padLeft, curY, labelColW, rowH);
    ctx.strokeRect(plotLeft, curY, plotW, rowH);
    ctx.restore();

    // Left header cell background + crisp translated Chinese label
    ctx.save();
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(padLeft + 1, curY + 1, labelColW - 2, rowH - 2);
    ctx.restore();
    drawFittedTextBox(
      ctx,
      band.rowTitle?.translated || band.rowTitle?.source || '',
      padLeft,
      curY,
      labelColW,
      rowH,
      {
        maxFontSize: 20,
        minFontSize: 12,
        weight: 'bold',
        color: '#0F172A',
        align: 'center',
        padding: 8,
      }
    );

    if (band.bandType === 'STATION_NUMBERS') {
      const cells = band.cells || [];
      if (cells.length > 0 && cells.some((c) => typeof c.xStart === 'number' && typeof c.xEnd === 'number')) {
        const spans = normalizeBandSpans(cells, totalLen);
        spans.forEach((sp, idx) => {
          const sx = xOf(sp.xStart);
          const ex = xOf(sp.xEnd);
          if (idx > 0) {
            ctx.save();
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(sx, curY);
            ctx.lineTo(sx, curY + rowH);
            ctx.stroke();
            ctx.restore();
          }
          drawFittedTextBox(ctx, sp.text, sx, curY, Math.max(20, ex - sx), rowH, {
            maxFontSize: 20,
            minFontSize: 12,
            weight: 'bold',
            align: 'center',
            padding: 4,
          });
        });
      } else {
        // Use spec.stations or band.cells with xMeters
        const sts =
          spec.stations && spec.stations.length > 0
            ? spec.stations
            : (band.cells || [])
                .filter((c) => typeof c.xMeters === 'number')
                .map((c) => ({ label: c.text, xMeters: c.xMeters as number }));
        ctx.save();
        ctx.font = `700 20px ${DIAGRAM_FONT_STACK}`;
        ctx.fillStyle = '#0F172A';
        ctx.textBaseline = 'middle';
        sts.forEach((st, idx) => {
          const sx = xOf(st.xMeters);
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(sx, curY);
          ctx.lineTo(sx, curY + rowH);
          ctx.stroke();
          ctx.textAlign = idx === 0 ? 'left' : idx === sts.length - 1 ? 'right' : 'center';
          const tx = idx === 0 ? sx + 10 : idx === sts.length - 1 ? sx - 10 : sx;
          ctx.fillText(st.label, tx, curY + rowH / 2);
        });
        ctx.restore();
      }
    } else if (band.bandType === 'INTERVAL_SPAN') {
      const spans = normalizeBandSpans(band.cells || [], totalLen);
      spans.forEach((sp, idx) => {
        const sx = xOf(sp.xStart);
        const ex = xOf(sp.xEnd);
        if (idx > 0) {
          ctx.save();
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(sx, curY);
          ctx.lineTo(sx, curY + rowH);
          ctx.stroke();
          ctx.restore();
        }
        drawFittedTextBox(ctx, sp.text, sx, curY, Math.max(18, ex - sx), rowH, {
          maxFontSize: 19,
          minFontSize: 11,
          weight: 'normal',
          align: 'center',
          padding: 3,
        });
      });
    } else if (band.bandType === 'VERTICAL_VALUE') {
      const sortedCells = [...(band.cells || [])].sort(
        (a, b) => (a.xMeters ?? 0) - (b.xMeters ?? 0)
      );
      ctx.save();
      ctx.font = `600 18px ${DIAGRAM_FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let lastX = -999;
      for (const cell of sortedCells) {
        const rawX = xOf(cell.xMeters ?? 0);
        // Draw vertical divider tick at true geometric position
        ctx.strokeStyle = '#94A3B8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(rawX, curY);
        ctx.lineTo(rawX, curY + rowH);
        ctx.stroke();

        // Nudge label text slightly if consecutive values are very close so text never overlaps
        let tx = Math.max(plotLeft + 14, Math.min(plotRight - 14, rawX));
        if (tx - lastX < 28) {
          tx = Math.min(plotRight - 14, lastX + 28);
        }
        lastX = tx;

        ctx.save();
        ctx.translate(tx + (tx === plotRight - 14 ? -12 : 12), curY + rowH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle =
          cell.color === 'red' ? '#B91C1C' : cell.color === 'blue' ? '#1D4ED8' : '#0F172A';
        ctx.fillText(cell.text, 0, 0, rowH - 12);
        ctx.restore();
      }
      ctx.restore();
    } else if (band.bandType === 'SLOPE_SEGMENT') {
      const slopes = [...(band.slopes || [])].sort((a, b) => a.xStart - b.xStart);
      const maxEnd = Math.max(...slopes.map((s) => s.xEnd), totalLen);
      const scale = maxEnd > 0 ? totalLen / maxEnd : 1;
      slopes.forEach((sl, idx) => {
        const sx = xOf(sl.xStart * scale);
        const ex = xOf(sl.xEnd * scale);
        const w = Math.max(30, ex - sx);

        if (idx > 0) {
          ctx.save();
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(sx, curY);
          ctx.lineTo(sx, curY + rowH);
          ctx.stroke();
          ctx.restore();
        }

        ctx.save();
        ctx.strokeStyle = '#0F172A';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        if (sl.direction === 'up') {
          ctx.moveTo(sx, curY + rowH);
          ctx.lineTo(ex, curY);
        } else if (sl.direction === 'down') {
          ctx.moveTo(sx, curY);
          ctx.lineTo(ex, curY + rowH);
        } else {
          ctx.moveTo(sx, curY + rowH / 2);
          ctx.lineTo(ex, curY + rowH / 2);
        }
        ctx.stroke();
        ctx.restore();

        if (sl.direction === 'flat') {
          drawFittedTextBox(ctx, sl.slopeValue, sx, curY + 2, w, rowH / 2 - 4, {
            maxFontSize: 18,
            minFontSize: 12,
            weight: 'bold',
          });
          drawFittedTextBox(ctx, sl.lengthValue, sx, curY + rowH / 2 + 2, w, rowH / 2 - 4, {
            maxFontSize: 18,
            minFontSize: 12,
          });
        } else if (sl.direction === 'up') {
          drawFittedTextBox(ctx, sl.slopeValue, sx + 4, curY + 4, w * 0.45, rowH * 0.45, {
            maxFontSize: 18,
            minFontSize: 12,
            weight: 'bold',
          });
          drawFittedTextBox(
            ctx,
            sl.lengthValue,
            sx + w * 0.52,
            curY + rowH * 0.5,
            w * 0.44,
            rowH * 0.45,
            { maxFontSize: 18, minFontSize: 12 }
          );
        } else {
          drawFittedTextBox(
            ctx,
            sl.slopeValue,
            sx + w * 0.52,
            curY + 4,
            w * 0.44,
            rowH * 0.45,
            { maxFontSize: 18, minFontSize: 12, weight: 'bold' }
          );
          drawFittedTextBox(
            ctx,
            sl.lengthValue,
            sx + 4,
            curY + rowH * 0.5,
            w * 0.45,
            rowH * 0.45,
            { maxFontSize: 18, minFontSize: 12 }
          );
        }
      });
    } else if (band.bandType === 'CURVE_PLAN') {
      const segs = [...(band.curveSegments || [])].sort((a, b) => a.xStart - b.xStart);
      const maxEnd = Math.max(...segs.map((s) => s.xEnd), totalLen);
      const scale = maxEnd > 0 ? totalLen / maxEnd : 1;
      const midY = curY + rowH * 0.58;

      // Centerline baseline across plan
      ctx.save();
      ctx.strokeStyle = '#94A3B8';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(plotLeft, midY);
      ctx.lineTo(plotRight, midY);
      ctx.stroke();
      ctx.restore();

      segs.forEach((seg) => {
        const sx = xOf(seg.xStart * scale);
        const ex = xOf(seg.xEnd * scale);
        const w = Math.max(40, ex - sx);

        ctx.save();
        ctx.strokeStyle = '#0F172A';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        if (seg.kind === 'straight') {
          ctx.moveTo(sx, midY);
          ctx.lineTo(ex, midY);
        } else if (seg.kind === 'curve_up') {
          const archTop = curY + 18;
          ctx.moveTo(sx, midY);
          ctx.lineTo(sx + w * 0.16, archTop);
          ctx.lineTo(ex - w * 0.16, archTop);
          ctx.lineTo(ex, midY);
        } else {
          const archBot = curY + rowH - 18;
          ctx.moveTo(sx, midY);
          ctx.lineTo(sx + w * 0.16, archBot);
          ctx.lineTo(ex - w * 0.16, archBot);
          ctx.lineTo(ex, midY);
        }
        ctx.stroke();
        ctx.restore();

        // Top labels (bearings etc.)
        const topText = (seg.topLabels || [])
          .map((l) => l.translated || l.source)
          .filter(Boolean)
          .join('  ');
        if (topText) {
          drawFittedTextBox(ctx, topText, sx, curY + 8, w, midY - curY - 16, {
            maxFontSize: 18,
            minFontSize: 12,
            weight: 'bold',
          });
        }

        // Bottom labels (straight lengths etc.)
        const botText = (seg.bottomLabels || [])
          .map((l) => l.translated || l.source)
          .filter(Boolean)
          .join('  ');
        if (botText) {
          drawFittedTextBox(ctx, botText, sx, midY + 8, w, curY + rowH - midY - 12, {
            maxFontSize: 18,
            minFontSize: 12,
          });
        }

        // Curve parameter block neatly laid out in 2 columns inside curve span
        const params = (seg.boxParams || [])
          .map((p) => p.translated || p.source)
          .filter(Boolean);
        if (params.length > 0) {
          const boxW = Math.min(w * 0.9, 520);
          const boxX = sx + (w - boxW) / 2;
          const boxY = seg.kind === 'curve_up' ? curY + 26 : curY + 16;
          const boxH = rowH - 36;
          const cols = params.length > 3 ? 2 : 1;
          const rows = Math.ceil(params.length / cols);
          const cellW = boxW / cols;
          const cellH = boxH / rows;

          ctx.save();
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.fillRect(boxX, boxY, boxW, boxH);
          ctx.restore();

          params.forEach((pText, idx) => {
            const c = Math.floor(idx / rows);
            const r = idx % rows;
            drawFittedTextBox(
              ctx,
              pText,
              boxX + c * cellW,
              boxY + r * cellH,
              cellW,
              cellH,
              {
                maxFontSize: 17,
                minFontSize: 11,
                weight: 'bold',
                color: '#0F172A',
                align: 'left',
                padding: 4,
              }
            );
          });
        }
      });
    }

    curY += rowH;
  }

  return canvas.toDataURL('image/png');
}

function renderDataChart(spec: DataChartSpec): string {
  const canvasW = 2000;
  const canvasH = 1260;
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Header & Title
  drawFittedTextBox(
    ctx,
    spec.title?.translated || '统计图表',
    80,
    36,
    canvasW - 160,
    56,
    { maxFontSize: 36, minFontSize: 20, weight: 'bold', color: '#0F172A' }
  );
  if (spec.subtitle?.translated) {
    drawFittedTextBox(
      ctx,
      spec.subtitle.translated,
      80,
      94,
      canvasW - 160,
      34,
      { maxFontSize: 22, minFontSize: 14, color: '#475569' }
    );
  }

  // Legend bar
  const legendY = spec.subtitle?.translated ? 140 : 108;
  const series = spec.series || [];
  if (series.length > 0 && spec.chartKind !== 'pie') {
    ctx.save();
    ctx.font = `600 20px ${DIAGRAM_FONT_STACK}`;
    let totalLW = 0;
    const items = series.map((s, idx) => {
      const name = s.name?.translated || `系列 ${idx + 1}`;
      const w = 32 + ctx.measureText(name).width + 36;
      totalLW += w;
      return {
        name,
        color: s.colorHex || CHART_PALETTE[idx % CHART_PALETTE.length],
        w,
      };
    });
    let lx = Math.max(120, (canvasW - totalLW) / 2);
    items.forEach((it) => {
      ctx.fillStyle = it.color;
      ctx.fillRect(lx, legendY + 6, 22, 14);
      ctx.fillStyle = '#1E293B';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(it.name, lx + 30, legendY + 13);
      lx += it.w;
    });
    ctx.restore();
  }

  // Pie Chart Branch
  if (spec.chartKind === 'pie' && series.length > 0) {
    const pts = series[0].points || [];
    const total = pts.reduce((sum, p) => sum + Math.max(0, p.yValue), 0) || 1;
    const cx = canvasW * 0.42;
    const cy = canvasH * 0.56;
    const radius = 340;
    let angle = -Math.PI / 2;

    pts.forEach((pt, idx) => {
      const slice = (Math.max(0, pt.yValue) / total) * Math.PI * 2;
      const color = CHART_PALETTE[idx % CHART_PALETTE.length];
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, angle, angle + slice);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();

      // Legend item on right
      const cat = spec.xCategories[idx]?.translated || pt.label || `项目 ${idx + 1}`;
      const pct = ((Math.max(0, pt.yValue) / total) * 100).toFixed(1);
      const ly = 280 + idx * 54;
      ctx.save();
      ctx.fillStyle = color;
      ctx.fillRect(canvasW * 0.72, ly, 24, 24);
      ctx.font = `600 22px ${DIAGRAM_FONT_STACK}`;
      ctx.fillStyle = '#0F172A';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${cat}: ${pt.yValue} (${pct}%)`, canvasW * 0.72 + 36, ly + 12);
      ctx.restore();

      angle += slice;
    });
    return canvas.toDataURL('image/png');
  }

  // Cartesian Plot Area
  const plotLeft = 180;
  const plotRight = canvasW - 90;
  const plotTop = legendY + 56;
  const plotBottom = canvasH - 165;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  const allY = series.flatMap((s) => s.points.map((p) => p.yValue));
  const rawMin = typeof spec.yMin === 'number' ? spec.yMin : Math.min(0, ...allY);
  const rawMax = typeof spec.yMax === 'number' ? spec.yMax : Math.max(10, ...allY);
  const yMin = rawMin;
  const yMax = rawMax <= rawMin ? rawMin + 10 : rawMax;
  const yRange = yMax - yMin;

  // Gridlines + Y-axis labels
  const tickCount = 6;
  ctx.save();
  ctx.font = `500 19px ${DIAGRAM_FONT_STACK}`;
  for (let i = 0; i <= tickCount; i++) {
    const val = yMin + (yRange * i) / tickCount;
    const py = plotBottom - (i / tickCount) * plotH;
    ctx.strokeStyle = i === 0 ? '#334155' : '#E2E8F0';
    ctx.lineWidth = i === 0 ? 2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(plotLeft, py);
    ctx.lineTo(plotRight, py);
    ctx.stroke();

    ctx.fillStyle = '#475569';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const labelStr = `${Number(val.toFixed(2))}${spec.yUnit ? ` ${spec.yUnit}` : ''}`;
    ctx.fillText(labelStr, plotLeft - 14, py);
  }
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(plotLeft, plotTop);
  ctx.lineTo(plotLeft, plotBottom);
  ctx.stroke();
  ctx.restore();

  // Axis Titles
  if (spec.yAxisLabel?.translated) {
    ctx.save();
    ctx.translate(46, plotTop + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = `700 22px ${DIAGRAM_FONT_STACK}`;
    ctx.fillStyle = '#0F172A';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.yAxisLabel.translated, 0, 0);
    ctx.restore();
  }
  if (spec.xAxisLabel?.translated) {
    drawFittedTextBox(
      ctx,
      spec.xAxisLabel.translated,
      plotLeft,
      canvasH - 64,
      plotW,
      44,
      { maxFontSize: 22, minFontSize: 14, weight: 'bold', color: '#0F172A' }
    );
  }

  const maxCatLen = Math.max(
    spec.xCategories.length,
    ...series.map((s) => s.points.length),
    1
  );

  // X categories
  for (let i = 0; i < spec.xCategories.length; i++) {
    const cx =
      spec.chartKind === 'bar'
        ? plotLeft + ((i + 0.5) / maxCatLen) * plotW
        : plotLeft + (maxCatLen === 1 ? 0.5 : i / (maxCatLen - 1)) * plotW;
    drawFittedTextBox(
      ctx,
      spec.xCategories[i]?.translated || '',
      cx - 80,
      plotBottom + 10,
      160,
      64,
      { maxFontSize: 19, minFontSize: 11, color: '#334155', padding: 2 }
    );
  }

  const yPx = (v: number) => plotBottom - ((v - yMin) / yRange) * plotH;

  // Draw bars / lines / area / scatter
  if (spec.chartKind === 'bar') {
    const groupW = plotW / maxCatLen;
    const barW = Math.min(72, (groupW * 0.72) / Math.max(1, series.length));
    series.forEach((s, sIdx) => {
      const color = s.colorHex || CHART_PALETTE[sIdx % CHART_PALETTE.length];
      s.points.forEach((pt, pIdx) => {
        const idx = typeof pt.xIndex === 'number' ? pt.xIndex : pIdx;
        const groupCenter = plotLeft + (idx + 0.5) * groupW;
        const bx =
          groupCenter - (series.length * barW) / 2 + sIdx * barW + 2;
        const by = yPx(pt.yValue);
        const bh = Math.max(2, plotBottom - by);
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, Math.max(8, barW - 4), bh);

        ctx.font = `600 16px ${DIAGRAM_FONT_STACK}`;
        ctx.fillStyle = '#0F172A';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(String(pt.label || pt.yValue), bx + barW / 2, by - 4);
      });
    });
  } else {
    series.forEach((s, sIdx) => {
      const color = s.colorHex || CHART_PALETTE[sIdx % CHART_PALETTE.length];
      const coords = s.points.map((pt, pIdx) => {
        const idx = typeof pt.xIndex === 'number' ? pt.xIndex : pIdx;
        const px =
          typeof pt.xValue === 'number' && maxCatLen > 1
            ? plotLeft + (idx / (maxCatLen - 1)) * plotW
            : plotLeft + (maxCatLen === 1 ? 0.5 : idx / (maxCatLen - 1)) * plotW;
        return { px, py: yPx(pt.yValue), val: pt.label || String(pt.yValue) };
      });

      if (spec.chartKind === 'area' && coords.length >= 2) {
        ctx.save();
        ctx.fillStyle = `${color}24`;
        ctx.beginPath();
        ctx.moveTo(coords[0].px, plotBottom);
        coords.forEach((c) => ctx.lineTo(c.px, c.py));
        ctx.lineTo(coords[coords.length - 1].px, plotBottom);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      if (spec.chartKind !== 'scatter' && coords.length >= 2) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 3.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        coords.forEach((c, i) => (i === 0 ? ctx.moveTo(c.px, c.py) : ctx.lineTo(c.px, c.py)));
        ctx.stroke();
        ctx.restore();
      }

      coords.forEach((c) => {
        ctx.save();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(c.px, c.py, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = `600 16px ${DIAGRAM_FONT_STACK}`;
        ctx.fillStyle = '#0F172A';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(c.val, c.px, c.py - 10);
        ctx.restore();
      });
    });
  }

  return canvas.toDataURL('image/png');
}

function renderSchematicDiagram(spec: SchematicDiagramSpec): string {
  const ratio = spec.aspectRatio && spec.aspectRatio > 0.3 && spec.aspectRatio < 3 ? spec.aspectRatio : 1.45;
  const canvasW = 2200;
  const headerH = 82;
  const bodyH = Math.round(canvasW / ratio);
  const canvasH = headerH + bodyH + 40;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasW, canvasH);

  drawFittedTextBox(
    ctx,
    spec.title?.translated || '技术示意图',
    60,
    18,
    canvasW - 120,
    54,
    { maxFontSize: 32, minFontSize: 18, weight: 'bold', color: '#0F172A' }
  );

  const mapX = (nx: number) => 40 + (Math.max(0, Math.min(1000, nx)) / 1000) * (canvasW - 80);
  const mapY = (ny: number) => headerH + (Math.max(0, Math.min(1000, ny)) / 1000) * bodyH;

  const nodeMap = new Map<string, { cx: number; cy: number; x: number; y: number; w: number; h: number }>();
  for (const n of spec.nodes || []) {
    const [ymin, xmin, ymax, xmax] = n.bboxNormalized;
    const x = mapX(xmin);
    const y = mapY(ymin);
    const w = Math.max(50, mapX(xmax) - x);
    const h = Math.max(36, mapY(ymax) - y);
    nodeMap.set(n.id, { cx: x + w / 2, cy: y + h / 2, x, y, w, h });
  }

  // 1. Edges
  for (const edge of spec.edges || []) {
    let pts: Array<[number, number]> = [];
    if (edge.pointsNormalized && edge.pointsNormalized.length >= 2) {
      pts = edge.pointsNormalized.map(([ny, nx]) => [mapX(nx), mapY(ny)]);
    } else if (edge.fromId && edge.toId) {
      const from = nodeMap.get(edge.fromId);
      const to = nodeMap.get(edge.toId);
      if (from && to) {
        pts = [
          [from.cx, from.cy],
          [to.cx, to.cy],
        ];
      }
    }
    if (pts.length < 2) continue;

    ctx.save();
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2.4;
    if (edge.style === 'dashed') ctx.setLineDash([10, 7]);
    ctx.beginPath();
    pts.forEach(([px, py], idx) => (idx === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.stroke();
    ctx.restore();

    if (edge.arrowEnd !== false) {
      const prev = pts[pts.length - 2];
      const last = pts[pts.length - 1];
      drawArrowhead(ctx, prev[0], prev[1], last[0], last[1], 12, '#334155');
    }

    if (edge.label?.translated) {
      const midIdx = Math.floor(pts.length / 2);
      const mx = (pts[midIdx - 1][0] + pts[midIdx][0]) / 2;
      const my = (pts[midIdx - 1][1] + pts[midIdx][1]) / 2;
      ctx.save();
      ctx.font = `600 18px ${DIAGRAM_FONT_STACK}`;
      const tw = ctx.measureText(edge.label.translated).width;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(mx - tw / 2 - 6, my - 13, tw + 12, 26);
      ctx.fillStyle = '#1D4ED8';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(edge.label.translated, mx, my);
      ctx.restore();
    }
  }

  // 2. Nodes
  for (const n of spec.nodes || []) {
    const geom = nodeMap.get(n.id);
    if (!geom) continue;
    const { x, y, w, h, cx, cy } = geom;
    const fill = n.fillHex || '#F8FAFC';
    const stroke = n.strokeHex || '#1E293B';

    ctx.save();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.2;

    if (n.shape === 'circle' || n.shape === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (n.shape === 'diamond') {
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(x + w, cy);
      ctx.lineTo(cx, y + h);
      ctx.lineTo(x, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (n.shape === 'rounded') {
      const r = Math.min(18, w / 4, h / 4);
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();
      ctx.stroke();
    } else if (n.shape !== 'text_box') {
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
    ctx.restore();

    drawFittedTextBox(ctx, n.label?.translated || n.label?.source || '', x, y, w, h, {
      maxFontSize: 22,
      minFontSize: 12,
      weight: 'bold',
      color: '#0F172A',
      padding: 8,
    });
  }

  // 3. Standalone callouts
  for (const c of spec.callouts || []) {
    const [ymin, xmin, ymax, xmax] = c.bboxNormalized;
    const x = mapX(xmin);
    const y = mapY(ymin);
    const w = Math.max(60, mapX(xmax) - x);
    const h = Math.max(28, mapY(ymax) - y);
    drawFittedTextBox(ctx, c.text?.translated || c.text?.source || '', x, y, w, h, {
      maxFontSize: 20,
      minFontSize: 12,
      weight: c.bold ? 'bold' : 'normal',
      align: c.align || 'center',
      padding: 4,
    });
  }

  return canvas.toDataURL('image/png');
}

export const diagramReconstructor = {
  /**
   * Reconstructs the ENTIRE chart/profile/schematic from scratch on a clean high-DPI Canvas 2D,
   * preserving zero untranslated raster remnants and filling all text in the target language.
   */
  async reconstructFromSpec(spec: DiagramReconstructionSpec): Promise<string> {
    if (spec.kind === 'ENGINEERING_PROFILE') {
      return renderEngineeringProfile(spec);
    }
    if (spec.kind === 'DATA_CHART') {
      return renderDataChart(spec);
    }
    return renderSchematicDiagram(spec);
  },
};
