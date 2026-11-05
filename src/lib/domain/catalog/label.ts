/**
 * How a SKU is named on screens and documents. The catalog's names already lead with the brand ("Cantinesca 1/2 bbl
 * keg"), so the brand is added only when the name does not start with it; never "Cantinesca Cantinesca".
 */
export function skuLabel(sku: { brand: string; name: string }): string {
  const name = sku.name.trim();
  const brand = sku.brand.trim();
  if (!brand || name.toLowerCase().startsWith(brand.toLowerCase())) return name;
  return `${brand} ${name}`;
}
