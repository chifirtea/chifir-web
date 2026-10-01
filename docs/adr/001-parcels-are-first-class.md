# ADR-001: Parcels are first-class records, separate from merchants

**Status:** accepted

## Context
Merchants need city coordinates. The roadmap includes virtual real estate (premium locations,
sponsored placement), pop-up stores with time-boxed tenancy, event venues, and automated
"place this business in the city" onboarding.

## Decision
`parcels` is its own table. A parcel owns `position`, `rotationY`, `size`, `tier`, `status`,
`sponsored`, and an optional `merchant_id`. A merchant is placed by occupying a parcel.

A merchant may hold several parcels (its storefront, a billboard, a pop-up); `occupied_from` /
`occupied_until` make tenancy time-boxed. `CityIndex.parcelByMerchant` resolves the storefront
parcel (first non-billboard parcel occupied now); `parcelsByMerchant` lists all of them. A
`parcel_tenancies` history table can be added later without changing the engine contract.

## Consequences
- Moving, swapping, or renting a location is a row update, not a merchant edit.
- The engine renders from `parcel × merchant` and never needs merchant-specific code.
- Empty parcels are renderable ("available") which is the seed of the real-estate product.
