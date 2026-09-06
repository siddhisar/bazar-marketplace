import { useState } from "react";
import Container from "../../components/layout/Container";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FiArrowRight, FiMail, FiUser } from "react-icons/fi";
import { FcGoogle } from "react-icons/fc";
import { googleSignInUrl } from "../../lib/api";
import { useAuth } from "../../store/AuthContext";
import { isSafeReturnPath } from "../../lib/returnTo";
import PasswordInput from "../../components/common/PasswordInput";
import Button from "../../components/common/Button";
import { textFieldClassName } from "../../components/common/Input";

/** Matches the server's minimum, so a rejection never comes as a surprise. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Registration.
 *
 * One kind of account, so nothing is chosen here beyond the credentials. A
 * registered person can browse, save searches and post listings; posting a
 * listing is what makes them its seller.
 *
 * The confirm-password check happens client-side because it is the only check a
 * client can usefully own: it catches a typo. Everything else is validated again
 * on the server.
 */
function Register() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signUp, googleEnabled } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** Where RequireAuth wanted to send them, if they arrived from a gate. */
  const rawFrom = (location.state as { from?: string } | null)?.from;
  const from = isSafeReturnPath(rawFrom) ? rawFrom : undefined;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    if (password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await signUp({ name, email, password });
      navigate(from ?? "/home");
    } catch (err) {
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
          Create your account
        </h1>
        <p className="mt-1 text-sm text-charcoal-500">
          Free, and takes less than a minute. One account covers browsing,
          saving searches and posting listings.
        </p>

        <form onSubmit={handleSubmit} className="mt-5">
          <div className="relative">
            <FiUser size={16} className={icon} />
            <input
              type="text"
              name="name"
              id="register-name"
              placeholder="Full name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              required
              className={field}
            />
          </div>

          <div className="relative mt-4">
            <FiMail size={16} className={icon} />
            <input
              type="email"
              name="email"
              id="register-email"
              placeholder="Email address"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              className={field}
            />
          </div>

          <PasswordInput
            name="new-password"
            id="register-password"
            placeholder={`Password (${MIN_PASSWORD_LENGTH}+ characters)`}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />

          <PasswordInput
            name="confirm-password"
            id="register-confirm"
            placeholder="Confirm password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
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
            {submitting ? "Please wait…" : "Create account"}
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

            <Button href={googleSignInUrl(from)} variant="outline" fullWidth>
              <FcGoogle size={18} />
              Sign up with Google
            </Button>
          </>
        )}

        <p className="mt-6 text-center text-sm text-charcoal-500">
          Already have an account?{" "}
          <Link
            to="/login"
            state={from ? { from } : undefined}
            className="font-bold text-charcoal-900 hover:underline"
          >
            Log in
          </Link>
        </p>
      </div>
    </Container>
  );
}

export default Register;
