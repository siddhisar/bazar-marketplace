import { useState } from "react";
import { Link, NavLink, useNavigate, useSearchParams } from "react-router-dom";
import {
  FiBookmark,
  FiGrid,
  FiHeart,
  FiLogOut,
  FiMenu,
  FiPlus,
  FiUser,
  FiX,
} from "react-icons/fi";
import Container from "../layout/Container";
import Logo from "../common/Logo";
import Button from "../common/Button";
import { DropdownMenu, dropdownItemClassName } from "../common/Dropdown";
import SearchBar from "../search/SearchBar";
import LocationSelector from "../search/LocationSelector";
import { CATEGORIES } from "../../data/marketplace";
import { useAuth } from "../../store/AuthContext";
import { useSavedListings } from "../../store/SavedListingsContext";
import { useSavedSearches } from "../../store/SavedSearchesContext";

/**
 * The marketplace header: brand, search, categories, and the actions a
 * classifieds site needs — save, saved searches, and posting an ad.
 *
 * "Sell Something" is `outline`, the same bordered chrome as every other
 * button/dropdown trigger in the header — a permanently-filled, border-less
 * `primary` button here was the one thing standing out as differently
 * styled next to Categories/Location beside it.
 */
function Navbar() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const { count: savedCount } = useSavedListings();
  const { searches } = useSavedSearches();

  /* The one search experience for the whole marketplace: it lives in the
     header on every page, including the home page, rather than the home page
     also carrying its own copy in the hero. Location travels with it, since a
     search and the place it is scoped to are one decision, not two. */
  const [city, setCity] = useState<string | null>(null);

  /* Seed the box from the URL, so the header shows the search that produced the
     page you are looking at. Without this, opening or reloading /search?q=car
     left the box blank while the results below were plainly filtered by "car" —
     and there was nothing for the clear button to act on. */
  const [searchParams] = useSearchParams();
  const activeQuery = searchParams.get("q") ?? "";

  const [mobileOpen, setMobileOpen] = useState(false);

  const iconLink =
    "relative flex h-11 w-11 items-center justify-center rounded-full text-charcoal-600 transition-all duration-150 hover:bg-sand hover:text-charcoal-900 hover:scale-105 active:scale-95 motion-reduce:transform-none";

  /**
   * The account entry point (signed in or not) — a plain nav link/profile
   * item, not a control someone picks a value from, so it skips the
   * `border-cyan-500`/`bg-mist` pill every dropdown/button in the header
   * otherwise shares. Same height as the other controls for alignment, same
   * `hover:bg-sand` feedback as the icon-only links beside it (`iconLink`
   * above) — the only two things that actually change here are dropped:
   * the border and the fill.
   */
  const accountLink =
    "flex h-11 items-center gap-2 rounded-full px-2.5 text-sm font-semibold text-charcoal-900 transition hover:bg-sand";

  const badge = (count: number) =>
    count > 0 ? (
      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-mist px-1 text-[10px] font-bold text-charcoal-900">
        {count > 99 ? "99+" : count}
      </span>
    ) : null;

  return (
    /* Transparent rather than a solid bar: no border and no shadow, so it reads
       as part of the same gradient surface as the hero beneath it rather than a
       block sitting on top of it. Blur plus a light tint is what keeps nav text
       readable once the page is scrolled and real content is passing underneath
       — a fully see-through bar would let card text collide with nav text. */
    <header className="sticky top-0 z-50 bg-gradient-to-r from-cyan-50/50 to-mint-50/50 backdrop-blur-md animate-[header-in_400ms_ease-out_both] motion-reduce:animate-none">
      <Container>
        <div className="flex h-18 items-center gap-3 sm:gap-5 lg:gap-7">
          <Logo />

          {/* The search cluster now carries most of the header's width and the
              "large" size of the box itself — once the header blends into the
              hero visually, this is the one thing in that whole band worth
              making the largest. Location only joins it from lg — at md there
              is barely room for the box itself, and a location picker with no
              search room to act on would be worse than not showing it. */}
          <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex md:max-w-xl lg:max-w-2xl xl:max-w-3xl">
            <div className="hidden flex-shrink-0 lg:block lg:w-36 xl:w-40">
              <LocationSelector value={city} onChange={setCity} className="w-full" />
            </div>
            <div className="min-w-0 flex-1">
              <SearchBar initialQuery={activeQuery} city={city} size="large" />
            </div>
          </div>

          {/* Everything that is not the search itself lives in one cluster
              pinned to the right edge — categories, saved items, the account
              menu and the primary action — rather than categories floating in
              the middle of the bar on its own. */}
          <div className="ml-auto flex items-center gap-1.5">
            {/* Held back to xl rather than lg: the location picker, this
                button, and the search box all compete for the same row, and
                turning this on at the same breakpoint the picker appears
                (lg) left the search box as little as 11px wide at
                1024–1279px — unusable, not merely tight. The mobile menu
                (below) stays available through that same range so
                categories are never actually unreachable. */}
            <div className="hidden xl:block">
              <DropdownMenu
                label="Categories"
                icon={
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-charcoal-900/10 text-charcoal-900">
                    <FiGrid size={14} />
                  </span>
                }
                panelClassName="grid w-64 gap-0.5"
                panel={({ close }) => (
                  <>
                    {CATEGORIES.map((category) => (
                      <Link
                        key={category.slug}
                        to={`/category/${category.slug}`}
                        onClick={close}
                        className={dropdownItemClassName}
                      >
                        {category.label}
                      </Link>
                    ))}
                  </>
                )}
              />
            </div>

            {/* Icon shortcuts from tablet up; on a phone they live in the menu,
                so the top bar stays uncrowded. */}
            <NavLink
              to="/saved-searches"
              className={`${iconLink} max-sm:hidden`}
              aria-label="Saved searches"
            >
              <FiBookmark size={18} />
              {badge(searches.length)}
            </NavLink>

            <NavLink
              to="/saved"
              className={`${iconLink} max-sm:hidden`}
              aria-label="Saved listings"
            >
              <FiHeart size={18} />
              {badge(savedCount)}
            </NavLink>

            <span aria-hidden className="mx-1 hidden h-6 w-px bg-taupe sm:block" />

            {user ? (
              <DropdownMenu
                triggerClassName={accountLink}
                icon={
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-charcoal-900 text-sm font-bold text-white">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                }
                label={
                  <span className="hidden sm:inline">
                    {user.name.split(" ")[0]}
                  </span>
                }
                panelClassName="w-52"
                panel={({ close }) => (
                  <>
                    <div className="px-3 py-2">
                      <p className="truncate text-xs text-charcoal-400">
                        {user.email}
                      </p>
                    </div>
                    <Link to="/profile" onClick={close} className={dropdownItemClassName}>
                      My profile
                    </Link>
                    <Link to="/my-listings" onClick={close} className={dropdownItemClassName}>
                      My Ads
                    </Link>
                    <Link to="/my-offers" onClick={close} className={dropdownItemClassName}>
                      Offers I Made
                    </Link>
                    <button
                      type="button"
                      onClick={async () => {
                        close();
                        await signOut();
                        navigate("/home");
                      }}
                      className={`${dropdownItemClassName} flex w-full items-center gap-2 text-left`}
                    >
                      <FiLogOut size={14} />
                      Log out
                    </button>
                  </>
                )}
              />
            ) : (
              <Link
                to="/login"
                className={`${accountLink} max-sm:hidden`}
              >
                <FiUser size={19} />
                Login
              </Link>
            )}

            {/* Shown to everyone. Posting needs an account, but the gate lives
                on the page itself (RequireAuth), so a signed-out visitor lands
                on a log-in prompt that returns them here afterwards rather than
                on a button that was hidden from them. */}
            <Button to="/post-ad" variant="outline" className="sm:px-6">
              <FiPlus size={17} />
              {/* Full label held back to lg: from sm to lg the search box is
                  already fighting the icon row and this button for space
                  (see the Categories/menu-toggle comment above), and "Post"
                  says the same thing in a third of the width. */}
              <span className="hidden lg:inline">Post an Ad</span>
              <span className="lg:hidden">Post</span>
            </Button>

            <button
              type="button"
              onClick={() => setMobileOpen((open) => !open)}
              aria-label="Menu"
              aria-expanded={mobileOpen}
              className={`${iconLink} xl:hidden`}
            >
              {mobileOpen ? <FiX size={20} /> : <FiMenu size={20} />}
            </button>
          </div>
        </div>

        {/* On narrow screens the search cluster gets its own row rather than
            shrinking into uselessness beside the logo, with location above the
            box rather than beside it — side by side, neither had room to say
            what it was. */}
        <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center md:hidden">
          <LocationSelector value={city} onChange={setCity} className="sm:w-40" />
          <div className="min-w-0 flex-1">
            <SearchBar initialQuery={activeQuery} city={city} size="large" />
          </div>
        </div>
      </Container>

      {mobileOpen && (
        <div className="border-t border-taupe bg-mist xl:hidden">
          <Container className="grid gap-1 py-3">
            {!user && (
              <Link
                to="/login"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-charcoal-900 transition hover:bg-sand"
              >
                <FiUser size={15} />
                Login / Sign Up
              </Link>
            )}
            <Link to="/my-listings" onClick={() => setMobileOpen(false)} className={dropdownItemClassName}>
              My Ads
            </Link>
            <Link to="/my-offers" onClick={() => setMobileOpen(false)} className={dropdownItemClassName}>
              Offers I Made
            </Link>
            <Link to="/saved" onClick={() => setMobileOpen(false)} className={dropdownItemClassName}>
              Saved listings
            </Link>
            <Link to="/saved-searches" onClick={() => setMobileOpen(false)} className={dropdownItemClassName}>
              Saved searches
            </Link>

            <p className="mt-2 px-3 text-xs font-bold uppercase tracking-wide text-charcoal-400">
              Categories
            </p>
            {CATEGORIES.map((category) => (
              <Link
                key={category.slug}
                to={`/category/${category.slug}`}
                onClick={() => setMobileOpen(false)}
                className={dropdownItemClassName}
              >
                {category.label}
              </Link>
            ))}
          </Container>
        </div>
      )}
    </header>
  );
}

export default Navbar;
