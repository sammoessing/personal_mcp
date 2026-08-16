/** One vehicle listing, normalised from whatever shape the source returns. */
export type VehicleListing = {
  listingId: string | null;
  url: string | null;

  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;

  price: number | null;
  mileage: number | null;

  bodyStyle: string | null;
  transmission: string | null;
  drivetrain: string | null;
  fuelType: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  titleStatus: string | null;
  condition: string | null;

  sellerName: string | null;
  sellerType: string | null;
  phone: string | null;

  city: string | null;
  state: string | null;
  zip: string | null;

  postedAt: string | null;
  /** Fields present in the source that no alias matched, kept so nothing is silently dropped. */
  extra: Record<string, unknown>;
};

export type SearchQuery = {
  make?: string;
  model?: string;
  yearMin?: number;
  yearMax?: number;
  priceMin?: number;
  priceMax?: number;
  mileageMax?: number;
  zip?: string;
  /** Miles from `zip`. */
  radius?: number;
  keyword?: string;
  page?: number;
  perPage?: number;
};
