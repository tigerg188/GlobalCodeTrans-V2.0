export enum CoordinateSpace {
  PDF_USER_SPACE = 'PDF_USER_SPACE',
  PDF_PAGE_SPACE = 'PDF_PAGE_SPACE',
  VIEWPORT_SPACE = 'VIEWPORT_SPACE',
  RENDER_PIXEL_SPACE = 'RENDER_PIXEL_SPACE',
  IMAGE_PIXEL_SPACE = 'IMAGE_PIXEL_SPACE',
  ENGINE_SPACE = 'ENGINE_SPACE',
  OUTPUT_SPACE = 'OUTPUT_SPACE',
}

/**
 * 2D Affine transformation matrix [a, b, c, d, e, f]
 * x' = a*x + c*y + e
 * y' = b*x + d*y + f
 */
export type AffineMatrix = [number, number, number, number, number, number];

export interface Point2D {
  x: number;
  y: number;
}

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
  coordinateSpace: CoordinateSpace;
}

export function createBbox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  coordinateSpace: CoordinateSpace
): BoundingBox {
  const minX = Math.min(x1, x2);
  const minY = Math.min(y1, y2);
  const maxX = Math.max(x1, x2);
  const maxY = Math.max(y1, y2);
  return {
    x1: minX,
    y1: minY,
    x2: maxX,
    y2: maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
    coordinateSpace,
  };
}

export function multiplyAffine(m1: AffineMatrix, m2: AffineMatrix): AffineMatrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function invertAffine(m: AffineMatrix): AffineMatrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) {
    throw new Error('Affine matrix is singular and cannot be inverted.');
  }
  const invDet = 1 / det;
  return [
    d * invDet,
    -b * invDet,
    -c * invDet,
    a * invDet,
    (c * f - d * e) * invDet,
    (b * e - a * f) * invDet,
  ];
}

export function applyAffineToPoint(m: AffineMatrix, pt: Point2D): Point2D {
  const [a, b, c, d, e, f] = m;
  return {
    x: a * pt.x + c * pt.y + e,
    y: b * pt.x + d * pt.y + f,
  };
}

export function applyAffineToBbox(
  m: AffineMatrix,
  bbox: BoundingBox,
  targetSpace: CoordinateSpace
): BoundingBox {
  const corners: Point2D[] = [
    applyAffineToPoint(m, { x: bbox.x1, y: bbox.y1 }),
    applyAffineToPoint(m, { x: bbox.x2, y: bbox.y1 }),
    applyAffineToPoint(m, { x: bbox.x2, y: bbox.y2 }),
    applyAffineToPoint(m, { x: bbox.x1, y: bbox.y2 }),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return createBbox(
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
    targetSpace
  );
}

/**
 * Builds the exact affine matrix mapping PDF_USER_SPACE (bottom-up, CropBox-relative)
 * into PDF_PAGE_SPACE (top-down, origin at top-left, unit = PDF point), accounting for CropBox & rotation.
 */
export function buildUserToPageMatrix(
  cropBox: [number, number, number, number],
  rotation: number
): AffineMatrix {
  const [cx1, cy1, cx2, cy2] = cropBox;
  const w = cx2 - cx1;
  const h = cy2 - cy1;
  const rot = ((rotation % 360) + 360) % 360;

  if (rot === 90) {
    return [0, 1, 1, 0, -cy1, -cx1];
  }
  if (rot === 180) {
    return [-1, 0, 0, 1, cx2, -cy1];
  }
  if (rot === 270) {
    return [0, -1, -1, 0, cy2, cx2];
  }
  // 0 deg: flip Y and shift by CropBox origin
  void w;
  void h;
  return [1, 0, 0, -1, -cx1, cy2];
}

export function pdfUserToPageSpace(
  bbox: BoundingBox,
  cropBox: [number, number, number, number],
  rotation: number
): BoundingBox {
  const m = buildUserToPageMatrix(cropBox, rotation);
  return applyAffineToBbox(m, bbox, CoordinateSpace.PDF_PAGE_SPACE);
}

/**
 * Maps PDF.js viewport transform (which maps PDF_USER_SPACE -> VIEWPORT_SPACE)
 * combined with inverse user->page transform if converting between PDF_PAGE_SPACE and VIEWPORT_SPACE.
 */
export function pageSpaceToViewport(
  bbox: BoundingBox,
  cropBox: [number, number, number, number],
  rotation: number,
  viewportTransform: AffineMatrix
): BoundingBox {
  const userToPage = buildUserToPageMatrix(cropBox, rotation);
  const pageToUser = invertAffine(userToPage);
  const pageToViewport = multiplyAffine(viewportTransform, pageToUser);
  return applyAffineToBbox(pageToViewport, bbox, CoordinateSpace.VIEWPORT_SPACE);
}

export function normalizedEngineToPageSpace(
  bboxNormalized: [number, number, number, number],
  pageWidthPt: number,
  pageHeightPt: number
): BoundingBox {
  // Gemini / normalized engine coordinates: [ymin, xmin, ymax, xmax] in 0..1000
  const [ymin, xmin, ymax, xmax] = bboxNormalized;
  const x1 = (Math.max(0, Math.min(1000, xmin)) / 1000) * pageWidthPt;
  const y1 = (Math.max(0, Math.min(1000, ymin)) / 1000) * pageHeightPt;
  const x2 = (Math.max(0, Math.min(1000, xmax)) / 1000) * pageWidthPt;
  const y2 = (Math.max(0, Math.min(1000, ymax)) / 1000) * pageHeightPt;
  return createBbox(x1, y1, x2, y2, CoordinateSpace.PDF_PAGE_SPACE);
}

export function computeBboxIoU(a: BoundingBox, b: BoundingBox): number {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter <= 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

export function computePdfTextItemUserBbox(
  tx: [number, number, number, number, number, number],
  itemWidth: number,
  fontHeight: number
): BoundingBox {
  // tx = [a, b, c, d, e, f] maps glyph local space -> PDF_USER_SPACE:
  // Baseline runs along (a, b); vertical ascender runs along (c, d).
  const [a, b, c, d, e, f] = tx;
  const xDirLen = Math.hypot(a, b);
  const yDirLen = Math.hypot(c, d);

  const ux = xDirLen > 1e-6 ? a / xDirLen : 1;
  const uy = xDirLen > 1e-6 ? b / xDirLen : 0;
  const vx = yDirLen > 1e-6 ? c / yDirLen : -uy;
  const vy = yDirLen > 1e-6 ? d / yDirLen : ux;

  const w = Math.max(1, itemWidth);
  const h = Math.max(4, fontHeight);

  // Compute all 4 corners of the rotated/skewed text glyph box in PDF_USER_SPACE
  const corners: Point2D[] = [
    { x: e, y: f },
    { x: e + ux * w, y: f + uy * w },
    { x: e + ux * w + vx * h, y: f + uy * w + vy * h },
    { x: e + vx * h, y: f + vy * h },
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return createBbox(
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
    CoordinateSpace.PDF_USER_SPACE
  );
}

/**
 * Independently cross-checks our buildUserToPageMatrix against PDF.js's own
 * page.getViewport({ scale }).transform to measure true coordinate alignment error (pt),
 * instead of testing a matrix only against its own algebraic inverse.
 */
export function verifyViewportCoordinateAlignment(
  userBbox: BoundingBox,
  cropBox: [number, number, number, number],
  rotation: number,
  pdfJsViewportTransform: AffineMatrix,
  renderScale = 1
): number {
  const ourPageBbox = pdfUserToPageSpace(userBbox, cropBox, rotation);
  const pdfJsViewportBbox = applyAffineToBbox(
    pdfJsViewportTransform,
    userBbox,
    CoordinateSpace.VIEWPORT_SPACE
  );
  const invScale = renderScale > 0 ? 1 / renderScale : 1;
  return Math.max(
    Math.abs(ourPageBbox.x1 - pdfJsViewportBbox.x1 * invScale),
    Math.abs(ourPageBbox.y1 - pdfJsViewportBbox.y1 * invScale),
    Math.abs(ourPageBbox.x2 - pdfJsViewportBbox.x2 * invScale),
    Math.abs(ourPageBbox.y2 - pdfJsViewportBbox.y2 * invScale)
  );
}

export function verifyRoundTripErrorPt(
  bbox: BoundingBox,
  cropBox: [number, number, number, number],
  rotation: number
): number {
  const m = buildUserToPageMatrix(cropBox, rotation);
  const inv = invertAffine(m);
  const forward = applyAffineToBbox(m, bbox, CoordinateSpace.PDF_PAGE_SPACE);
  const back = applyAffineToBbox(inv, forward, bbox.coordinateSpace);
  return Math.max(
    Math.abs(back.x1 - bbox.x1),
    Math.abs(back.y1 - bbox.y1),
    Math.abs(back.x2 - bbox.x2),
    Math.abs(back.y2 - bbox.y2)
  );
}
