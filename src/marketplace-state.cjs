function isMeaningful(value) {
  return value !== undefined && value !== null && value !== '';
}

function resolveValue(canonical, legacy) {
  if (isMeaningful(canonical)) return canonical;
  if (isMeaningful(legacy)) return legacy;
  return canonical !== undefined ? canonical : legacy;
}

function getMarketplace(project) {
  const listing = project?.tptListing && typeof project.tptListing === 'object' ? project.tptListing : {};
  const m = listing.marketplace && typeof listing.marketplace === 'object' ? listing.marketplace : {};
  const s = m.settings && typeof m.settings === 'object' ? m.settings : {};
  const r = m.review && typeof m.review === 'object' ? m.review : {};
  const u = m.upload && typeof m.upload === 'object' ? m.upload : {};

  return {
    settings: {
      isFreeResource: resolveValue(s.isFreeResource, listing.isFreeResource),
      suggestedPrice: resolveValue(s.suggestedPrice, listing.suggestedPrice),
      multipleLicensePrice: resolveValue(s.multipleLicensePrice, listing.multipleLicensePrice),
      bundleDiscountPrice: resolveValue(s.bundleDiscountPrice, listing.bundleDiscountPrice),
      taxCode: resolveValue(s.taxCode, listing.taxCode),
      copyrightDeclaration: resolveValue(s.copyrightDeclaration, listing.copyrightDeclaration),
      publicationStatus: resolveValue(s.publicationStatus, listing.publicationStatus)
    },
    review: {
      approved: resolveValue(r.approved, listing.reviewApproved),
      approvedAt: resolveValue(r.approvedAt, listing.reviewApprovedAt),
      sellerApproved: resolveValue(r.sellerApproved, listing.sellerApproved)
    },
    upload: {
      stage: resolveValue(u.stage, listing.uploadStage),
      error: resolveValue(u.error, listing.uploadError),
      message: resolveValue(u.message, listing.uploadMessage),
      verified: resolveValue(u.verified, listing.uploadVerified),
      productUrl: resolveValue(u.productUrl, listing.productUrl),
      formContract: resolveValue(u.formContract, listing.formContract)
    }
  };
}

function mirrorMarketplaceOnListing(listing) {
  if (!listing || typeof listing !== 'object') return listing;
  const canonical = getMarketplace({ tptListing: listing });
  return applyMarketplaceToListing(listing, canonical);
}

function applyMarketplaceToListing(listing, patch = {}) {
  const current = getMarketplace({ tptListing: listing });
  
  const ps = patch.settings || {};
  const pr = patch.review || {};
  const pu = patch.upload || {};

  const next = {
    settings: {
      isFreeResource: ps.isFreeResource !== undefined ? ps.isFreeResource : current.settings.isFreeResource,
      suggestedPrice: ps.suggestedPrice !== undefined ? ps.suggestedPrice : current.settings.suggestedPrice,
      multipleLicensePrice: ps.multipleLicensePrice !== undefined ? ps.multipleLicensePrice : current.settings.multipleLicensePrice,
      bundleDiscountPrice: ps.bundleDiscountPrice !== undefined ? ps.bundleDiscountPrice : current.settings.bundleDiscountPrice,
      taxCode: ps.taxCode !== undefined ? ps.taxCode : current.settings.taxCode,
      copyrightDeclaration: ps.copyrightDeclaration !== undefined ? ps.copyrightDeclaration : current.settings.copyrightDeclaration,
      publicationStatus: ps.publicationStatus !== undefined ? ps.publicationStatus : current.settings.publicationStatus
    },
    review: {
      approved: pr.approved !== undefined ? pr.approved : current.review.approved,
      approvedAt: pr.approvedAt !== undefined ? pr.approvedAt : current.review.approvedAt,
      sellerApproved: pr.sellerApproved !== undefined ? pr.sellerApproved : current.review.sellerApproved
    },
    upload: {
      stage: pu.stage !== undefined ? pu.stage : current.upload.stage,
      error: pu.error !== undefined ? pu.error : current.upload.error,
      message: pu.message !== undefined ? pu.message : current.upload.message,
      verified: pu.verified !== undefined ? pu.verified : current.upload.verified,
      productUrl: pu.productUrl !== undefined ? pu.productUrl : current.upload.productUrl,
      formContract: pu.formContract !== undefined ? pu.formContract : current.upload.formContract
    }
  };

  const nextListing = {
    ...(listing || {}),
    marketplace: next,
    isFreeResource: next.settings.isFreeResource,
    suggestedPrice: next.settings.suggestedPrice,
    multipleLicensePrice: next.settings.multipleLicensePrice,
    bundleDiscountPrice: next.settings.bundleDiscountPrice,
    taxCode: next.settings.taxCode,
    copyrightDeclaration: next.settings.copyrightDeclaration,
    publicationStatus: next.settings.publicationStatus,
    reviewApproved: next.review.approved,
    reviewApprovedAt: next.review.approvedAt,
    sellerApproved: next.review.sellerApproved,
    uploadStage: next.upload.stage,
    uploadError: next.upload.error,
    uploadMessage: next.upload.message,
    uploadVerified: next.upload.verified,
    productUrl: next.upload.productUrl,
    formContract: next.upload.formContract
  };

  // Clean undefined legacy fields so they don't explicitly override with undefined
  for (const key of Object.keys(nextListing)) {
    if (nextListing[key] === undefined) delete nextListing[key];
  }

  return nextListing;
}

module.exports = {
  getMarketplace,
  mirrorMarketplaceOnListing,
  applyMarketplaceToListing
};
