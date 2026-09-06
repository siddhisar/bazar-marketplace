import { Link, useNavigate } from "react-router-dom";
import Container from "../../components/layout/Container";
import { FiBookmark, FiHeart, FiList, FiLogOut, FiTag, FiUser } from "react-icons/fi";
import { fetchMyListings, fetchMyOffers } from "../../lib/api";
import { useApi } from "../../hooks/useApi";
import { useAuth } from "../../store/AuthContext";
import { useSavedListings } from "../../store/SavedListingsContext";
import { useSavedSearches } from "../../store/SavedSearchesContext";
import BackLink from "../../components/common/BackLink";
import Button from "../../components/common/Button";

/**
 * The signed-in user's own page: who they are, and the counts that lead into
 * their listings, offers, saved items and saved searches.
 */
function Profile() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { count: savedCount } = useSavedListings();
  const { searches } = useSavedSearches();
  const { data: myListings } = useApi(fetchMyListings, []);
  const { data: myOffers } = useApi(fetchMyOffers, []);

  // RequireAuth already guarantees a session; this only satisfies the type.
  if (!user) return null;

  const tiles = [
    {
      to: "/my-listings",
      icon: <FiList size={18} />,
      label: "My Ads",
      value: (myListings ?? []).filter((listing) => listing.status === "active").length,
      caption: "active",
    },
    {
      to: "/my-offers",
      icon: <FiTag size={18} />,
      label: "Offers I Made",
      value: (myOffers ?? []).length,
      caption: "sent",
    },
    {
      to: "/saved",
      icon: <FiHeart size={18} />,
      label: "Saved listings",
      value: savedCount,
      caption: "saved",
    },
    {
      to: "/saved-searches",
      icon: <FiBookmark size={18} />,
      label: "Saved searches",
      value: searches.length,
      caption: "tracked",
    },
  ];

  return (
    <Container className="py-8" narrow="md">
      <BackLink className="mb-4" />

      <div className="rounded-2xl border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 p-6">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-charcoal-900 text-white">
            <FiUser size={22} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-black tracking-tight text-charcoal-900">
              {user.name}
            </h1>
            <p className="truncate text-sm text-charcoal-500">{user.email}</p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="mt-5"
          onClick={async () => {
            await signOut();
            navigate("/home");
          }}
        >
          <FiLogOut size={14} />
          Log out
        </Button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {tiles.map((tile) => (
          <Link
            key={tile.to}
            to={tile.to}
            className="rounded-2xl border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 p-5 shadow-sm shadow-charcoal-900/5 transition hover:-translate-y-0.5 hover:border-charcoal-200 hover:shadow-md motion-reduce:hover:translate-y-0"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600">
              {tile.icon}
            </span>
            <p className="mt-3 text-2xl font-black tracking-tight text-charcoal-900">
              {tile.value}
            </p>
            <p className="text-xs text-charcoal-400">{tile.caption}</p>
            <p className="mt-1 text-sm font-bold text-charcoal-900">{tile.label}</p>
          </Link>
        ))}
      </div>
    </Container>
  );
}

export default Profile;
