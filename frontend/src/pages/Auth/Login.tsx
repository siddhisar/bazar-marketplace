import { useState } from "react";
import Container from "../../components/layout/Container";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FiArrowRight, FiMail } from "react-icons/fi";
import PasswordInput from "../../components/common/PasswordInput";
import Button from "../../components/common/Button";
import { textFieldClassName } from "../../components/common/Input";
import { FcGoogle } from "react-icons/fc";
import { googleSignInUrl } from "../../lib/api";
import { useAuth } from "../../store/AuthContext";
import { isSafeReturnPath } from "../../lib/returnTo";

/**
 * Sign-in.
 *
 * One door, because there is one kind of account. What a signed-in person may
 * do is decided per action rather than at the login form: posting and saved
 * searches need only an account, and changing a listing needs to own it.
 *
 * Email/password flow on submit:
 *   Form submit -> signIn({email, password}) (AuthContext)
 *   -> loginUser() POST /api/auth/login (lib/api.ts)
 *   -> backend verifies the password hash, starts a session, sets a cookie
 *   -> AuthContext stores the returned user -> this page navigates away.
 *
 * "Continue with Google" is not a fetch — it's a plain `<a href>` below,
 * because the whole point is to leave this page and let the browser itself
 * visit Google's own sign-in screen:
 *   Click -> browser navigates to GET /api/auth/google (backend)
 *   -> backend redirects to Google's consent screen
 *   -> user approves -> Google redirects back to the backend's callback URL
 *      with a one-time code
 *   -> backend exchanges the code for the user's profile (google.service.ts)
 *      and creates/links/signs in the account, then redirects to the
 *      frontend with a `?auth=...` marker
 *   -> AuthContext (see store/AuthContext.tsx) reads that marker on load,
 *      re-checks the session, and shows a banner if it failed.
 */
function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, googleEnabled } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Both fields start read-only, and stop being so the moment either is
   * touched.
   *
   * Chrome fills a login form on page load whenever exactly one credential is
   * saved for the origin, and no autocomplete token prevents it — `off` is
   * explicitly ignored on login forms. What it does skip is a read-only field,
   * so the form opens empty; the attribute is dropped on first focus, which is
   * before the saved-credential dropdown is offered, so picking an account and
   * having the password filled in behaves exactly as normal afterwards.
   *
   * Deliberately not solved with `new-password`: that stops the password
   * manager offering to save or update the password at all, which is the
   * opposite of what is wanted.
   */
  const [autofillLocked, setAutofillLocked] = useState(true);
  const unlockAutofill = () => setAutofillLocked(false);

  const rawFrom = (location.state as { from?: string } | null)?.from;
  // Re-validated here even though every call site is only ever supposed to
  // pass an internal path — this is the value that actually goes into
  // `navigate()`, so it must not depend on every caller having gotten that
  // right, only on this one check.
  const from = isSafeReturnPath(rawFrom) ? rawFrom : undefined;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    setError(null);
    setSubmitting(true);
    try {
      await signIn({ email, password });
      navigate(from ?? "/home");
    } catch (err) {
      // The server's wording is written to be read, so show it as-is.
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const field = `w-full ${textFieldClassName} py-3 pl-11 pr-4 text-sm`;
  const icon =
    "pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-charcoal-400";

  return (
    <Container className="py-12" narrow="sm">
      <div className="rounded-2xl border border-taupe bg-gradient-to-br from-cyan-50 to-mint-50 p-7">
        <h1 className="text-xl font-black tracking-tight text-charcoal-900">
          Log in to Bazaar Marketplace
        </h1>
        <p className="mt-1 text-sm text-charcoal-500">
          To post listings, save searches and manage what you have posted.
        </p>

        <form onSubmit={handleSubmit} className="mt-6">
          <div className="relative">
            <FiMail size={16} className={icon} />
            <input
              type="email"
              name="email"
              id="login-email"
              placeholder="Email address"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              // "username" is the token password managers look for on a login
              // form; "email" alone is matched less reliably.
              autoComplete="username"
              readOnly={autofillLocked}
              // Both: focus covers tabbing in, and pointerdown fires before the
              // click that opens the suggestion list, so the field is already
              // editable by the time Chrome decides whether to offer it.
              onFocus={unlockAutofill}
              onPointerDown={unlockAutofill}
              required
              className={field}
            />
          </div>

          <PasswordInput
            name="password"
            id="login-password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            readOnly={autofillLocked}
            onFocus={unlockAutofill}
            onPointerDown={unlockAutofill}
            required
          />

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="outline"
            fullWidth
            disabled={submitting}
            className="mt-5"
          >
            {submitting ? "Please wait…" : "Log in"}
            {!submitting && <FiArrowRight size={16} />}
          </Button>
        </form>

        {googleEnabled && (
          <>
            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-taupe" />
              <span className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">
                or
              </span>
              <span className="h-px flex-1 bg-taupe" />
            </div>

            {/* A link, not a fetch: the browser itself must visit Google. */}
            <Button href={googleSignInUrl(from)} variant="outline" fullWidth>
              <FcGoogle size={18} />
              Continue with Google
            </Button>
          </>
        )}

        <p className="mt-6 text-center text-sm text-charcoal-500">
          New to Bazaar Marketplace?{" "}
          <Link
            to="/register"
            state={from ? { from } : undefined}
            className="font-bold text-charcoal-900 hover:underline"
          >
            Create an account
          </Link>
        </p>
      </div>
    </Container>
  );
}

export default Login;
