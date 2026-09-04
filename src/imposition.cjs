/**
 * Imposition Module for Booklet Printing (Saddle Stitching)
 */

function calculateSaddleStitchSpreads(pageCount) {
  const N = Math.max(0, Math.floor(Number(pageCount) || 0));
  if (N === 0) {
    return {
      inputPageCount: 0,
      paddedPageCount: 0,
      padCount: 0,
      totalSpreads: 0,
      spreads: []
    };
  }

  const remainder = N % 4;
  const padCount = remainder === 0 ? 0 : 4 - remainder;
  const paddedPageCount = N + padCount;
  const totalSpreads = paddedPageCount / 2;
  const spreads = [];

  for (let i = 1; i <= totalSpreads; i++) {
    const isOdd = i % 2 !== 0;
    const leftPage = isOdd ? paddedPageCount - (i - 1) : i;
    const rightPage = isOdd ? i : paddedPageCount - (i - 1);

    const padNumberStr = (num) => String(num).padStart(2, '0');
    const spreadNumStr = padNumberStr(i);
    const leftStr = `p${leftPage}`;
    const rightStr = `p${rightPage}`;
    const fileName = `spread_${spreadNumStr}_${leftStr}_${rightStr}.png`;

    spreads.push({
      spreadIndex: i,
      leftPage,
      rightPage,
      isLeftBlank: leftPage > N,
      isRightBlank: rightPage > N,
      fileName
    });
  }

  return {
    inputPageCount: N,
    paddedPageCount,
    padCount,
    totalSpreads,
    spreads
  };
}

module.exports = {
  calculateSaddleStitchSpreads
};
