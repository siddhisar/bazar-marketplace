/**
 * This file wires up client-side routing with React Router: `<Routes>` picks
 * one `<Route>` to render based on the current URL path, entirely in the
 * browser — no page reload, no round trip to the server, just React swapping
 * which component is on screen. `lazy(...)` + `<Suspense>` is what makes
 * each route's code download only when that route is actually visited,
 * instead of the browser downloading the whole site's JavaScript upfront.
 */
import { lazy, Suspense, useEffect } from "react";
import Container from "./components/layout/Container";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Navbar from "./components/Navbar/Navbar";
import Footer from "./components/Footer/Footer";
import EmptyState from "./components/common/EmptyState";
import MobilePostBar from "./components/common/MobilePostBar";
import RequireAuth from "./components/common/RequireAuth";
import BrandLoader from "./components/common/BrandLoader";
import { RouteGateProvider } from "./store/RouteGate";
import { prefetchLikelyRoutes, routeChunks } from "./lib/routeChunks";
import Welcome from "./pages/Welcome/Welcome";

/*
 * The landing page is imported eagerly: it is the site's entry point, it opens
 * with its own staged entrance, and putting a loader in front of the very first
 * paint would be the one place a spinner is genuinely unwelcome.
 *
 * Every other page is code-split with React.lazy, so a route's JavaScript is
 * only fetched when someone actually goes there. The Suspense boundary below
 * shows the branded BrandLoader for the moment a chunk is in flight.
 *
 * That is the first of two waits a navigation can have. The second is the page's
 * own first data fetch, held by the RouteGate — and because both stages render
 * the same BrandLoader, the two read as one continuous screen rather than a
 * loader that blinks out and comes back. Only once real data is in does the page
 * appear, at which point its skeletons cover anything still trickling in.
 */
const Home = lazy(routeChunks.home);
const SearchResults = lazy(routeChunks.search);
const ListingDetails = lazy(routeChunks.listing);
const CategoryPage = lazy(routeChunks.category);
const PostAd = lazy(routeChunks.postAd);
const MyListings = lazy(routeChunks.myListings);
const MyOffers = lazy(routeChunks.myOffers);
const SavedSearches = lazy(routeChunks.savedSearches);
const SavedListings = lazy(routeChunks.savedListings);
const Login = lazy(routeChunks.login);
const Register = lazy(routeChunks.register);
const Profile = lazy(routeChunks.profile);

/**
 * Returns to the top when the path changes.
 *
 * Keyed on pathname only, deliberately: the search page rewrites its query
 * string on every filter click, and scrolling to the top each time would yank
 * the page away from someone reading halfway down the results.
 */
function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);

  return null;
}

/**
 * Routes for Bazaar.
 *
 * Browsing, searching, filtering, sorting and opening a listing need no account.
 * Exactly four things do — posting, saved searches, the seller dashboard and the
 * profile — and each is wrapped in RequireAuth.
 *
 * One account system: there is no buyer/seller split to express here, and no
 * separate seller door. "Seller" describes whoever a listing belongs to, and
 * whether a signed-in person may change a given listing is an ownership
 * question only the server can settle.
 */
function App() {
  const { pathname } = useLocation();

  /* The onboarding is a full screen of its own: the marketplace header and
     footer around it would give away the page it is introducing.

     "/" is the welcome page and "/home" is the marketplace, so opening the site
     always starts at the introduction — no flag, no first-visit special case,
     and a refresh shows the same thing. */
  const onboarding = pathname === "/" || pathname === "/welcome";

  /* Pull the browsing chunks down while the browser is idle, so the first click
     into search or a listing does not wait on a download. React holds the
     current page on screen while a lazy chunk loads, which makes a cold one feel
     like a click that did nothing — this is what removes that. */
  useEffect(prefetchLikelyRoutes, []);

  return (
    <RouteGateProvider>
    <div className="flex min-h-screen flex-col">
      <ScrollToTop />
      {!onboarding && <Navbar />}

      <main className="flex-1">
        {/* One boundary around every route. A lazy page suspends while its chunk
            loads and the branded loader covers the viewport, so there is never a
            blank or half-built page between a link click and the next screen. */}
        <Suspense fallback={<BrandLoader />}>
        <Routes>
          {/* The site opens here. Choosing a role pushes, so Back from the
              marketplace returns to the introduction rather than leaving the
              site. */}
          <Route path="/" element={<Welcome />} />
          {/* Alias, so an old link or bookmark still lands somewhere sensible */}
          {/* Both paths render the landing page. "/welcome" is the named entry
              point; "/" is what a bare domain resolves to, and redirecting one
              to the other would put a pointless hop in front of the first page
              anyone sees. */}
          <Route path="/welcome" element={<Welcome />} />

          {/* The marketplace homepage, reached by choosing USER */}
          <Route path="/home" element={<Home />} />
          <Route path="/search" element={<SearchResults />} />
          <Route path="/listing/:id" element={<ListingDetails />} />
          <Route path="/category/:category" element={<CategoryPage />} />
          {/* Not gated: the page itself renders empty for a signed-out visitor
              (SavedListingsContext holds no ids without a session) and the
              heart toggle is what actually prompts login, same as elsewhere. */}
          <Route path="/saved" element={<SavedListings />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          {/* The separate seller doors are gone. Kept as redirects so an old
              link or bookmark lands on the one login rather than a 404. */}
          <Route path="/seller/login" element={<Navigate to="/login" replace />} />
          <Route
            path="/seller/register"
            element={<Navigate to="/register" replace />}
          />

          {/* Needs an account */}
          <Route
            path="/post-ad"
            element={
              <RequireAuth action="sell something">
                <PostAd />
              </RequireAuth>
            }
          />
          <Route
            path="/edit-listing/:id"
            element={
              <RequireAuth action="edit a listing">
                <PostAd />
              </RequireAuth>
            }
          />
          <Route
            path="/my-listings"
            element={
              <RequireAuth action="see your listings">
                <MyListings />
              </RequireAuth>
            }
          />
          <Route
            path="/saved-searches"
            element={
              <RequireAuth action="save searches">
                <SavedSearches />
              </RequireAuth>
            }
          />
          <Route
            path="/my-offers"
            element={
              <RequireAuth action="see your offers">
                <MyOffers />
              </RequireAuth>
            }
          />
          <Route
            path="/profile"
            element={
              <RequireAuth action="see your profile">
                <Profile />
              </RequireAuth>
            }
          />

          <Route
            path="*"
            element={
              <Container className="py-16" narrow="md">
                <EmptyState
                  as="h1"
                  title="Page not found"
                  description="That link does not point anywhere on Bazaar Marketplace."
                />
              </Container>
            }
          />
        </Routes>
        </Suspense>
      </main>

      {!onboarding && <MobilePostBar />}
      {!onboarding && <Footer />}
    </div>
    </RouteGateProvider>
  );
}

export default App;
