import { vi } from "vitest";

// `server-only` throws when imported outside a React Server Components bundle. Tests that
// exercise server modules (row mappers, data sources) only need it to be inert.
vi.mock("server-only", () => ({}));
