import { Link } from "react-router-dom";
import { FiFacebook, FiInstagram } from "react-icons/fi";
import Container from "../layout/Container";
import { CATEGORIES } from "../../data/marketplace";

/** Cities the seeded listings actually use — kept in sync with `seedListings100k.ts`. */
const POPULAR_CITIES = ["Mumbai", "Delhi", "Bengaluru", "Pune", "Hyderabad", "Chennai"];

const linkClass = "text-sm text-charcoal-500 transition hover:text-charcoal-900";
const headingClass = "text-xs font-bold uppercase tracking-wide text-charcoal-900";

/**
 * Site footer. Carries the category and city links a search engine and a
 * browsing visitor both use, plus the safety note a classifieds site is
 * expected to show.
 *
 * Layout mirrors a standard five-column marketplace footer (brand, quick
 * links, safety, categories, cities) while keeping the site's own light
 * warm-neutral palette — no new colors introduced here.
 */
function Footer() {
  return (
    <footer className="mt-20 border-t border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 pb-20 sm:pb-0">
      <Container className="py-12 sm:py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-6">
          <div className="sm:col-span-2 lg:col-span-2">
            <p className="text-lg font-black tracking-tight text-charcoal-900">
              BAZAAR MARKETPLACE
            </p>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-charcoal-500">
              Buy and sell second-hand things near you. Post an ad in
              minutes, or search thousands of listings from people in your city.
            </p>

            {/* Decorative only — Bazaar has no live social accounts yet, so
                these aren't links to anywhere. */}
            <div className="mt-5 flex gap-2">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-mist text-charcoal-900"
              >
                <FiFacebook size={16} />
              </span>
              <span
                aria-hidden="true"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-mist text-charcoal-900"
              >
                <FiInstagram size={16} />
              </span>
            </div>
          </div>

          <div>
            <p className={headingClass}>Marketplace</p>
            <ul className="mt-4 space-y-2.5">
              <li>
                <Link to="/post-ad" className={linkClass}>
                  Post an Ad
                </Link>
              </li>
              <li>
                <Link to="/my-listings" className={linkClass}>
                  My Ads
                </Link>
              </li>
              <li>
                <Link to="/saved-searches" className={linkClass}>
                  Saved searches
                </Link>
              </li>
              <li>
                <Link to="/saved" className={linkClass}>
                  Saved items
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className={headingClass}>Support &amp; Safety</p>
            <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-charcoal-500">
              <li>Meet in a public place.</li>
              <li>Check the item before you pay.</li>
              <li>Never pay a deposit in advance.</li>
            </ul>
          </div>

          <div>
            <p className={headingClass}>Popular categories</p>
            <ul className="mt-4 space-y-2.5">
              {CATEGORIES.slice(0, 6).map((category) => (
                <li key={category.slug}>
                  <Link to={`/category/${category.slug}`} className={linkClass}>
                    {category.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className={headingClass}>Popular cities</p>
            <ul className="mt-4 space-y-2.5">
              {POPULAR_CITIES.map((city) => (
                <li key={city}>
                  <Link
                    to={`/search?city=${encodeURIComponent(city)}`}
                    className={linkClass}
                  >
                    {city}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-taupe pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-charcoal-400">
            Buy and sell locally, safely and for free.
          </p>
          <p className="text-xs text-charcoal-400">
            © {new Date().getFullYear()} Bazaar Marketplace. All rights reserved.
          </p>
        </div>
      </Container>
    </footer>
  );
}

export default Footer;
