import {
  useEffect,
  useState,
} from "react";

import {
  apiRequest,
} from "../../api/client.js";

import {
  cacheUserProfile,
  clearAuthSession,
  saveAuthSession,
} from "../../api/auth.js";

import HexBackdrop from "../HexBackdrop.jsx";
import BrandLogo from "../ui/BrandLogo.jsx";
import Icon from "../ui/Icon.jsx";


export function readPasswordRecoveryLinkFromLocation() {
  if (
    typeof window ===
    "undefined"
  ) {
    return {
      identifier: "",
      code: "",
    };
  }

  const hash =
    window.location.hash
      .startsWith(
        "#?",
      )
      ? window.location.hash.slice(
          2,
        )
      : "";

  const params =
    new URLSearchParams(
      hash,
    );

  const identifier =
    params
      .get(
        "recovery_identifier",
      )
      ?.trim() ??
    "";

  const code =
    params
      .get(
        "recovery_code",
      )
      ?.trim() ??
    "";

  return {
    identifier,
    code:
      /^\d{6}$/.test(
        code,
      )
        ? code
        : "",
  };
}


export function readPasswordResetTokenFromLocation() {
  if (
    typeof window ===
    "undefined"
  ) {
    return "";
  }

  if (
    window.location.pathname !==
    "/reset-password"
  ) {
    return "";
  }

  return (
    new URLSearchParams(
      window.location.search,
    )
      .get(
        "token",
      )
      ?.trim() ??
    ""
  );
}


function clearPasswordResetUrl() {
  if (
    typeof window ===
    "undefined"
  ) {
    return;
  }

  window.history.replaceState(
    {},
    "",
    "/",
  );
}


export default function PasswordRecoveryOverlay({
  open,
  onClose,
  onBackToSignIn,
  onAuthenticated,
  onPasswordReset,
}) {
  const recoveryLink =
    readPasswordRecoveryLinkFromLocation();

  const [
    resetToken,
    setResetToken,
  ] = useState(
    () =>
      readPasswordResetTokenFromLocation(),
  );

  const [
    step,
    setStep,
  ] = useState(
    () => (
      readPasswordResetTokenFromLocation()
        ? "reset"
        : recoveryLink.code &&
            recoveryLink.identifier
          ? "otp"
          : "request"
    ),
  );

  const [
    recoveryIdentifier,
    setRecoveryIdentifier,
  ] = useState(
    () =>
      recoveryLink.identifier,
  );

  const [
    identifier,
    setIdentifier,
  ] = useState("");

  const [
    otp,
    setOtp,
  ] = useState(
    () =>
      recoveryLink.code,
  );

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    busy,
    setBusy,
  ] = useState(false);

  const [
    resetComplete,
    setResetComplete,
  ] = useState(false);


  useEffect(() => {
    if (!open) {
      return;
    }

    const locationToken =
      readPasswordResetTokenFromLocation();

    if (locationToken) {
      setResetToken(
        locationToken,
      );
      setStep(
        "reset",
      );
      setResetComplete(
        false,
      );
      setMessage(
        "",
      );
      return;
    }

    const linkedRecovery =
      readPasswordRecoveryLinkFromLocation();

    if (
      linkedRecovery.identifier &&
      linkedRecovery.code
    ) {
      setRecoveryIdentifier(
        linkedRecovery.identifier,
      );
      setIdentifier(
        "",
      );
      setOtp(
        linkedRecovery.code,
      );
      setStep(
        "otp",
      );
      setMessage(
        "Recovery code loaded from your email.",
      );
      return;
    }

    if (!resetComplete) {
      setStep(
        "request",
      );
      setMessage(
        "",
      );
    }
  }, [
    open,
    resetComplete,
  ]);


  const visible =
    open ||
    Boolean(
      resetToken,
    ) ||
    resetComplete;

  if (!visible) {
    return null;
  }


  function backToSignIn() {
    clearPasswordResetUrl();
    setResetToken("");
    setResetComplete(false);
    setRecoveryIdentifier("");
    setIdentifier("");
    setOtp("");
    setStep("request");
    setMessage("");
    onBackToSignIn?.();
  }


  function closeOverlay() {
    clearPasswordResetUrl();
    setResetToken("");
    setResetComplete(false);
    setRecoveryIdentifier("");
    setIdentifier("");
    setOtp("");
    setStep("request");
    setMessage("");
    onClose?.();
  }


  async function requestRecovery(
    event,
  ) {
    event.preventDefault();

    const normalized =
      identifier.trim();

    if (!normalized) {
      setMessage(
        "Enter your username or email.",
      );
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const data =
        await apiRequest(
          "/auth/password-recovery/request",
          {
            method: "POST",
            body: JSON.stringify(
              {
                identifier:
                  normalized,
              },
            ),
          },
        );

      setRecoveryIdentifier(
        normalized,
      );
      setIdentifier(
        "",
      );
      setOtp(
        "",
      );
      setStep(
        "otp",
      );
      setMessage(
        data?.detail ??
          "Recovery email sent.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to send recovery email.",
      );
    } finally {
      setBusy(false);
    }
  }


  async function verifyOtp(
    event,
  ) {
    event.preventDefault();

    const normalizedOtp =
      otp.trim();

    setBusy(true);
    setMessage("");

    try {
      const data =
        await apiRequest(
          "/auth/password-recovery/verify-otp",
          {
            method: "POST",
            body: JSON.stringify(
              {
                identifier:
                  recoveryIdentifier.trim(),
                otp:
                  normalizedOtp,
              },
            ),
          },
        );

      saveAuthSession(
        data.access_token,
        {
          remember:
            true,
        },
      );

      cacheUserProfile(
        data.user,
        {
          remember:
            true,
        },
      );

      onAuthenticated?.(
        data.user,
      );
      onClose?.();

      setRecoveryIdentifier("");
      setIdentifier("");
      setOtp("");
      setStep("request");
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Recovery code could not be verified.",
      );
    } finally {
      setBusy(false);
    }
  }


  async function resetPassword(
    event,
  ) {
    event.preventDefault();

    const form =
      new FormData(
        event.currentTarget,
      );

    const newPassword =
      String(
        form.get(
          "new_password",
        ) ??
          "",
      );

    const confirmPassword =
      String(
        form.get(
          "confirm_password",
        ) ??
          "",
      );

    if (
      newPassword !==
      confirmPassword
    ) {
      setMessage(
        "The new passwords do not match.",
      );
      return;
    }

    if (
      newPassword.length <
      8
    ) {
      setMessage(
        "Password must be at least 8 characters.",
      );
      return;
    }

    if (!resetToken) {
      setMessage(
        "This password reset link is missing its token.",
      );
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const data =
        await apiRequest(
          "/auth/password-recovery/reset",
          {
            method: "POST",
            body: JSON.stringify(
              {
                token:
                  resetToken,
                new_password:
                  newPassword,
              },
            ),
          },
        );

      clearAuthSession();
      onPasswordReset?.();
      clearPasswordResetUrl();
      setResetToken("");
      setResetComplete(true);
      setMessage(
        data?.detail ??
          "Password updated.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Password could not be reset.",
      );
    } finally {
      setBusy(false);
    }
  }


  const isReset =
    step ===
    "reset";

  const isOtp =
    step ===
    "otp";

  const title =
    resetComplete
      ? "Password updated"
      : isReset
        ? "Choose a new password"
        : isOtp
          ? "Enter your recovery code"
          : "Recover your account";

  const copy =
    resetComplete
      ? (
          "Your old sessions were signed out. " +
          "Use your new password to sign in."
        )
      : isReset
        ? (
            "Choose a new password for your " +
            "HyperSync account."
          )
        : isOtp
          ? (
              "Enter the 6-digit code from the " +
              "recovery email to sign back in."
            )
          : (
              "Enter the username or email on " +
              "your account. We will send both " +
              "a sign-in code and a password reset link."
            );

  return (
    <div
      className="auth-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-title"
    >
      <HexBackdrop
        idPrefix="password-recovery-background"
      />

      <div className="auth-panel bevel-panel">
        <button
          className="auth-close"
          type="button"
          onClick={
            closeOverlay
          }
          aria-label="Close password recovery"
        >
          <Icon
            name="close"
            size={20}
          />
        </button>

        <BrandLogo
          idPrefix="password-recovery-logo"
        />

        <div className="auth-heading">
          <h2 id="recovery-title">
            {title}
          </h2>

          <p>
            {copy}
          </p>
        </div>

        {resetComplete ? (
          <button
            className="auth-submit"
            type="button"
            onClick={
              backToSignIn
            }
          >
            BACK TO SIGN IN
          </button>
        ) : isReset ? (
          <form
            className="auth-form"
            onSubmit={
              resetPassword
            }
          >
            <label>
              <Icon
                name="lock"
                size={22}
              />
              <input
                type="password"
                name="new_password"
                autoComplete="new-password"
                placeholder="New password"
                minLength={8}
                maxLength={128}
                required
              />
            </label>

            <label>
              <Icon
                name="lock"
                size={22}
              />
              <input
                type="password"
                name="confirm_password"
                autoComplete="new-password"
                placeholder="Confirm new password"
                minLength={8}
                maxLength={128}
                required
              />
            </label>

            <button
              className="auth-submit"
              type="submit"
              disabled={
                busy
              }
            >
              {busy
                ? "UPDATING..."
                : "RESET PASSWORD"}
            </button>
          </form>
        ) : isOtp ? (
          <form
            className="auth-form"
            autoComplete="off"
            onSubmit={
              verifyOtp
            }
          >
            <label>
              <Icon
                name="mail"
                size={22}
              />
              <input
                key="recovery-otp"
                type="text"
                name="otp"
                value={
                  otp ?? ""
                }
                onChange={(
                  event,
                ) => {
                  setOtp(
                    event.target.value
                      .replace(
                        /\D/g,
                        "",
                      )
                      .slice(
                        0,
                        6,
                      ),
                  );
                }}
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                placeholder="6-digit code"
                required
              />
            </label>

            <button
              className="auth-submit"
              type="submit"
              disabled={
                busy
              }
            >
              {busy
                ? "CHECKING..."
                : "SIGN IN WITH CODE"}
            </button>

            <div className="auth-options">
              <button
                type="button"
                disabled={
                  busy
                }
                onClick={() => {
                  setRecoveryIdentifier(
                    "",
                  );
                  setIdentifier(
                    "",
                  );
                  setOtp(
                    "",
                  );
                  setStep(
                    "request",
                  );
                  setMessage(
                    "",
                  );
                }}
              >
                Send another code
              </button>

              <button
                type="button"
                onClick={
                  backToSignIn
                }
              >
                Back to sign in
              </button>
            </div>
          </form>
        ) : (
          <form
            className="auth-form"
            autoComplete="off"
            onSubmit={
              requestRecovery
            }
          >
            <label>
              <Icon
                name="mail"
                size={22}
              />
              <input
                key="recovery-identifier"
                type="text"
                value={
                  identifier ?? ""
                }
                onChange={(
                  event,
                ) => {
                  setIdentifier(
                    event.target.value,
                  );
                }}
                name="recovery_identifier"
                autoComplete="off"
                placeholder="Username or email"
                maxLength={320}
                required
              />
            </label>

            <button
              className="auth-submit"
              type="submit"
              disabled={
                busy
              }
            >
              {busy
                ? "SENDING..."
                : "SEND RECOVERY CODE"}
            </button>
          </form>
        )}

        {!resetComplete ? (
          <>
            <div className="auth-divider">
              <span>OR</span>
            </div>

            <button
              className="auth-secondary"
              type="button"
              onClick={
                backToSignIn
              }
            >
              BACK TO SIGN IN
            </button>
          </>
        ) : null}

        {message ? (
          <p
            className="auth-message"
            role="status"
          >
            {message}
          </p>
        ) : null}

        <p className="auth-legal">
          Recovery codes and reset links expire 
          after 15 minutes for account security.
        </p>
      </div>
    </div>
  );
}
