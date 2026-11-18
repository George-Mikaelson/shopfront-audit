import * as cheerio from 'cheerio';

export type JsonLdItem = Record<string, unknown>;

/** Every JSON-LD object on the page, with @graph and top-level arrays flattened. */
export function extractJsonLd(html: string): { items: JsonLdItem[]; errors: string[] } {
  const $ = cheerio.load(html);
  const items: JsonLdItem[] = [];
  const errors: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      collect(JSON.parse(raw) as unknown, items);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  });
  return { items, errors };
}

function collect(value: unknown, into: JsonLdItem[]): void {
  if (Array.isArray(value)) {
    for (const v of value) collect(v, into);
  } else if (isObject(value)) {
    const graph = value['@graph'];
    if (Array.isArray(graph)) collect(graph, into);
    else into.push(value);
  }
}

/**
 * schema.org types that are LocalBusiness or one of its common descendants.
 * Not exhaustive (schema.org has ~150), but covers what small shops use.
 */
const LOCAL_BUSINESS_TYPES = new Set(
  `LocalBusiness Restaurant FoodEstablishment CafeOrCoffeeShop Bakery BarOrPub Brewery Winery
  FastFoodRestaurant IceCreamShop Distillery Store ClothingStore BookStore GroceryStore
  ConvenienceStore Florist HardwareStore JewelryStore PetStore ShoeStore SportingGoodsStore
  ToyStore FurnitureStore ElectronicsStore HomeGoodsStore BikeStore LiquorStore OutletStore
  HealthAndBeautyBusiness BeautySalon HairSalon DaySpa NailSalon TattooParlor
  MedicalBusiness Dentist Optician Pharmacy Physician LodgingBusiness Hotel Hostel
  BedAndBreakfast Motel AutomotiveBusiness AutoRepair AutoDealer ProfessionalService
  LegalService Attorney Notary AccountingService FinancialService RealEstateAgent
  HomeAndConstructionBusiness Electrician Plumber Locksmith HousePainter RoofingContractor
  SportsActivityLocation ExerciseGym EntertainmentBusiness ChildCare DryCleaningOrLaundry
  TravelAgency AnimalShelter ShoppingCenter`.split(/\s+/),
);

const FOOD_TYPES = new Set(
  'Restaurant FoodEstablishment CafeOrCoffeeShop Bakery BarOrPub Brewery Winery FastFoodRestaurant IceCreamShop Distillery'.split(
    ' ',
  ),
);

export function typesOf(item: JsonLdItem): string[] {
  const t = item['@type'];
  const list = Array.isArray(t) ? t : [t];
  return list
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.replace(/^(https?:\/\/schema\.org\/|schema:)/, ''));
}

export function findLocalBusiness(items: JsonLdItem[]): JsonLdItem | undefined {
  return items.find((i) => typesOf(i).some((t) => LOCAL_BUSINESS_TYPES.has(t)));
}

export interface BusinessValidation {
  type: string;
  missingRequired: string[];
  missingRecommended: string[];
}

/**
 * Properties Google's local business rich results rely on. "Required" here is
 * what we consider the minimum for a shop to be described correctly.
 */
export function validateLocalBusiness(item: JsonLdItem): BusinessValidation {
  const types = typesOf(item);
  const isFood = types.some((t) => FOOD_TYPES.has(t));
  const missingRequired: string[] = [];
  const missingRecommended: string[] = [];

  if (!filled(item.name)) missingRequired.push('name');
  if (!hasAddress(item.address)) missingRequired.push('address');
  if (!filled(item.telephone)) missingRequired.push('telephone');
  if (!filled(item.openingHours) && !filled(item.openingHoursSpecification)) {
    missingRequired.push('openingHours');
  }

  const recommended = ['url', 'image', 'geo', 'priceRange'];
  if (isFood) recommended.push('servesCuisine', 'menu');
  for (const key of recommended) {
    const value = key === 'menu' ? (item.menu ?? item.hasMenu) : item[key];
    if (!filled(value)) missingRecommended.push(key);
  }

  return { type: types[0] ?? 'LocalBusiness', missingRequired, missingRecommended };
}

/** Text value of a JSON-LD property (string, or the obvious field of an object). */
export function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return textOf(value[0]);
  if (isObject(value)) {
    const parts = ['streetAddress', 'postalCode', 'addressLocality', 'addressRegion']
      .map((k) => value[k])
      .filter((v): v is string => typeof v === 'string');
    if (parts.length > 0) return parts.join(', ');
    return textOf(value.name);
  }
  return undefined;
}

function hasAddress(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasAddress);
  if (isObject(value)) return filled(value.streetAddress) || filled(value.addressLocality);
  return false;
}

function filled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function isObject(value: unknown): value is JsonLdItem {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
