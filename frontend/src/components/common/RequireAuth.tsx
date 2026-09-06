import type { ReactNode } from "react";
import Container from "../layout/Container";
import { Link, useLocation } from "react-router-dom";
import { FiLogIn, FiUserPlus } from "react-icons/fi";
import { useAuth } from "../../store/AuthContext";
import { currentReturnPath } from "../../lib/returnTo";
import Button from "./Button";

type RequireAuthProps = {
  /** What the account is needed for, e.g. "sell something". */
  action: string;
  children: ReactNode;
};

/**
 * Gate for the pages that need an account.
 *
 * Browsing, searching, filtering, sorting and opening a listing are open to
 * everyone; this only ever wraps the rest — posting, saved searches, and the
 * seller dashboard.
 *
 * There is one kind of refusal, because there is one kind of account: nobody is
 * signed in. Anyone signed in may post, so there is no second "your account is
 * the wrong sort" case to express.
 *
 * This is presentation only. Whether a signed-in person may change a particular
 * listing is a question of who owns it, and only the server can answer that —
 * every write endpoint has to check ownership itself regardless of what is
 * shown here.
 */
function RequireAuth({ action, children }: RequireAuthProps) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const from = currentReturnPath(location);

  // Waiting on /me. Showing a refusal here would flash it at someone who is in
  // fact signed in, every time they reload the page.
  if (loading) {
    return (
      <Container className="py-12" narrow="md">
        <div className="h-56 animate-pulse rounded-2xl bg-taupe" />
      </Container>
    );
  }

  if (!user) {
    return (
      <Container className="py-16" narrow="sm">
        <div className="rounded-2xl border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 p-7 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-cyan-50 text-cyan-600">
            <FiLogIn size={22} />
          </span>

          <h1 className="mt-5 text-lg font-black tracking-tight text-charcoal-900">
            Log in to {action}
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-charcoal-500">
            Browsing and searching are always free. An account is only needed to
            post a listing, save a search, and manage what you have posted.
          </p>

          {/* The intended destination rides along, so signing in returns here
              rather than dumping the visitor on the homepage. */}
          <Button to="/login" state={{ from }} variant="outline" fullWidth className="mt-6">
            <FiLogIn size={15} />
            Log in
          </Button>

          <Button to="/register" state={{ from }} variant="outline" fullWidth className="mt-3">
            <FiUserPlus size={15} />
            Create an account
          </Button>

          <Link
            to="/search"
            className="mt-5 inline-block text-sm font-semibold text-charcoal-500 transition hover:text-charcoal-900"
          >
            Keep browsing instead
          </Link>
        </div>
      </Container>
    );
  }

  return <>{children}</>;
}

export default RequireAuth;
