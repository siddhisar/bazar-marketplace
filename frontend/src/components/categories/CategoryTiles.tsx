import { Link } from "react-router-dom";
import {
  LuBike,
  LuBookOpen,
  LuCamera,
  LuCar,
  LuCookingPot,
  LuDumbbell,
  LuGamepad2,
  LuGuitar,
  LuLaptop,
  LuPawPrint,
  LuShirt,
  LuShoppingBag,
  LuSmartphone,
  LuSofa,
  LuTv,
  LuWatch,
} from "react-icons/lu";
import Container from "../layout/Container";
import type { ApiCategory } from "../../lib/api";

type CategoryTilesProps = {
  /**
   * Categories with their live counts, from the API. Passed in rather than
   * fetched here so the homepage makes one request for the whole page instead
   * of this component issuing a second one.
   */
  categories: ApiCategory[];
};

/**
 * One icon per slug, drawn from Lucide rather than Feather.
 *
 * Feather has no sofa, guitar, paw or dress, so several categories were
 * borrowing something vaguely adjacent — furniture used a house, bikes reused
 * the same lightning bolt as electronics. Lucide has a real glyph for each of
 * these, which is the difference between a label you read and one you
 * recognise at a glance.
 *
 * Every key here must exist in `listing_categories`; a slug with no entry falls
 * back to a neutral chip rather than rendering nothing.
 */
const ICONS: Record<string, React.ReactNode> = {
  mobiles: <LuSmartphone size={26} />,
  electronics: <LuTv size={26} />,
  computers: <LuLaptop size={26} />,
  cars: <LuCar size={26} />,
  bikes: <LuBike size={26} />,
  furniture: <LuSofa size={26} />,
  "home-kitchen": <LuCookingPot size={26} />,
  "mens-fashion": <LuShirt size={26} />,
  "womens-fashion": <LuShoppingBag size={26} />,
  "books-stationery": <LuBookOpen size={26} />,
  sports: <LuDumbbell size={26} />,
  toys: <LuGamepad2 size={26} />,
  music: <LuGuitar size={26} />,
  cameras: <LuCamera size={26} />,
  pets: <LuPawPrint size={26} />,
  accessories: <LuWatch size={26} />,
};


/**
 * One gradient per category, used on the icon chip only.
 *
 * The rest of the site stays monochrome — this is the single place colour is
 * allowed, because sixteen identical grey squares are genuinely harder to scan
 * than sixteen distinct ones. Colour here is doing a job (telling tiles apart
 * at a glance), not decorating.
 *
 * A two-stop gradient rather than a flat fill: at this size a flat chip reads
 * as a sticker, and the slight depth is what stops a grid of sixteen looking
 * like a settings screen.
 */
const ICON_COLOURS: Record<string, string> = {
  mobiles: "bg-gradient-to-br from-red-500 to-red-700",
  electronics: "bg-gradient-to-br from-stone-500 to-stone-700",
  computers: "bg-gradient-to-br from-violet-500 to-violet-700",
  cars: "bg-gradient-to-br from-lime-500 to-lime-700",
  bikes: "bg-gradient-to-br from-amber-500 to-amber-700",
  furniture: "bg-gradient-to-br from-orange-500 to-orange-700",
  "home-kitchen": "bg-gradient-to-br from-teal-500 to-teal-700",
  "mens-fashion": "bg-gradient-to-br from-cyan-500 to-cyan-700",
  "womens-fashion": "bg-gradient-to-br from-pink-500 to-pink-700",
  "books-stationery": "bg-gradient-to-br from-emerald-500 to-emerald-700",
  sports: "bg-gradient-to-br from-green-500 to-green-700",
  toys: "bg-gradient-to-br from-yellow-500 to-amber-600",
  music: "bg-gradient-to-br from-purple-500 to-purple-700",
  cameras: "bg-gradient-to-br from-fuchsia-500 to-fuchsia-700",
  pets: "bg-gradient-to-br from-rose-500 to-rose-700",
  accessories: "bg-gradient-to-br from-yellow-500 to-yellow-700",
};

/**
 * The category row that sits across the bottom edge of the hero.
 *
 * Counts are derived from the active listings rather than written into the data,
 * so a tile can never advertise more than a search would actually return.
 *
 * Sits directly on the page's own light gradient rather than in a separate
 * panel — the sixteen colour chips are the only colour here, so the section
 * stays part of the same surface as everything above and below it instead of
 * reading as its own showcase.
 */
/**
 * Sixteen tiles, laid out 2/3/4/5 across the breakpoints so the last row is
 * never left with a single orphan. The "other" filter is a leftover guard from
 * when a catch-all category existed; it costs nothing and keeps the grid tidy
 * if one is ever reintroduced.
 */
function CategoryTiles({ categories }: CategoryTilesProps) {
  const tiles = categories.filter((entry) => entry.slug !== "other");

  return (
    <Container className="pt-10">
      <div className="mb-7 text-center sm:text-left">
        <h2 className="text-lg font-black tracking-tight text-charcoal-900 sm:text-xl">
          Browse by category
        </h2>
        <p className="mt-1 text-sm text-charcoal-500">
          Sixteen ways in — pick one, or search for anything.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {tiles.map((category, index) => (
          <Link
            key={category.slug}
            to={`/search?category=${category.slug}`}
            /* Stagger kept short on purpose: at 35ms a step the last of
               thirteen tiles did not begin until 840ms, which is a long time
               for content to sit mid-fade. 18ms tops out under 550ms. */
            style={{ animationDelay: `${320 + index * 18}ms` }}
            className="group relative flex animate-[rise-in_0.5s_ease-out_both] flex-col items-center gap-3 overflow-hidden rounded-2xl border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 px-3 py-7 text-center shadow-sm shadow-charcoal-900/5 transition-all duration-300 ease-out hover:-translate-y-1.5 hover:border-cyan-400 hover:shadow-lg hover:shadow-cyan-500/20 motion-reduce:animate-none motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            {/* A wash of the tile's own colour, revealed on hover. Sits behind
                the content and is inert, so it tints without touching layout. */}
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-10 ${
                ICON_COLOURS[category.slug] ?? "bg-cyan-500"
              }`}
            />

            <span
              className={`relative flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-sm transition-transform duration-300 ease-out group-hover:-translate-y-0.5 group-hover:scale-110 group-hover:rotate-6 motion-reduce:transform-none ${
                ICON_COLOURS[category.slug] ?? "bg-gradient-to-br from-cyan-500 to-cyan-700"
              }`}
            >
              {ICONS[category.slug]}
            </span>

            <span className="relative min-w-0">
              <span className="block text-sm font-bold leading-tight text-charcoal-900">
                {category.label}
              </span>
              <span className="mt-1 block text-xs text-charcoal-500 transition-colors duration-300 group-hover:text-charcoal-700">
                {category.total.toLocaleString("en-IN")} ads
              </span>
            </span>
          </Link>
        ))}
      </div>
    </Container>
  );
}

export default CategoryTiles;
