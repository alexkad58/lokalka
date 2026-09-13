import { normalizeQuery } from './search.js';

export function detectPackageType(productName) {
  const normalizedName = normalizeQuery(productName);
  if (normalizedName.includes('ж/б')) return 'can';
  if (normalizedName.includes('ст')) return 'glass';
  return 'pet';
}

export function getPackageTypeLabel(packageType) {
  if (packageType === 'can') return 'Железная банка';
  if (packageType === 'glass') return 'Стеклянная бутылка';
  return 'ПЭТ бутылка';
}
